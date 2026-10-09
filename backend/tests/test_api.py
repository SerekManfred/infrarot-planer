"""API-Ablauf von der Anmeldung bis zur versionierten Berechnung.

Alle Zahlen sind TESTWERTE (Fantasiewerte), keine Norm- oder Pauschalwerte.
Die Berechnung läuft über den echten Rechenkern (Node im Test-Container).
"""
import pytest

from tests.conftest import anmelden


def test_ohne_anmeldung_gesperrt(client):
    assert client.get("/api/projekte").status_code == 401
    assert client.get("/api/gesundheit").json() == {"status": "ok"}


def test_anmeldung_falsches_passwort(client, berater):
    antwort = client.post("/api/auth/anmelden", json={"email": berater.email, "passwort": "falsch-falsch-falsch"})
    assert antwort.status_code == 401
    antwort = client.post("/api/auth/anmelden", json={"email": "gibts@nicht.invalid", "passwort": "egal-egal-egal"})
    assert antwort.status_code == 401


def test_anmelden_ich_abmelden(client, berater):
    anmelden(client, "BERATER@test.invalid")  # Groß-/Kleinschreibung egal
    cookie = client.cookies.get("infrarot_sitzung")
    assert cookie
    assert client.get("/api/auth/ich").json()["rolle"] == "berater"
    client.post("/api/auth/abmelden")
    assert client.get("/api/auth/ich").status_code == 401


def test_deaktivierter_benutzer(client, db, berater):
    berater.aktiv = False
    db.commit()
    assert client.post("/api/auth/anmelden", json={"email": berater.email, "passwort": "test-passwort-123"}).status_code == 401


def test_rechte_berater(client, berater):
    anmelden(client, berater.email)
    assert client.get("/api/benutzer").status_code == 403
    projekt = client.post("/api/projekte", json={"nummer": "P-1", "bezeichnung": "Test"}).json()
    assert client.delete(f"/api/projekte/{projekt['id']}").status_code == 403
    csv = b"bezeichnung;theta_int;luftwechsel;quelle\nTESTWERT;20;0,5;TESTWERT\n"
    assert client.post("/api/bibliotheken/raumtypen/import", files={"datei": ("r.csv", csv)}).status_code == 403


def test_admin_legt_benutzer_an(client, admin):
    anmelden(client, admin.email)
    neu = {"email": "neu@test.invalid", "name": "Neu", "passwort": "noch-ein-passwort", "rolle": "berater"}
    assert client.post("/api/benutzer", json=neu).status_code == 201
    assert client.post("/api/benutzer", json=neu).status_code == 409
    assert len(client.get("/api/benutzer").json()) == 2


def test_projektnummer_eindeutig(client, berater):
    anmelden(client, berater.email)
    assert client.post("/api/projekte", json={"nummer": "P-1", "bezeichnung": "A"}).status_code == 201
    assert client.post("/api/projekte", json={"nummer": "P-1", "bezeichnung": "B"}).status_code == 409


def _post(client, url, daten):
    antwort = client.post(url, json=daten)
    assert antwort.status_code == 201, antwort.text
    return antwort.json()


@pytest.fixture
def testobjekt(client, admin):
    """Ein Objekt mit einem Raum wie im Rechenkern-Test (Φ_HL = 509,25 W bei TESTWERTEN)."""
    anmelden(client, admin.email)
    for art, csv in {
        "klimadaten": "plz;ort;theta_e;quelle\n00000;TESTORT;-10;TESTWERT\n",
        "raumtypen": "bezeichnung;theta_int;luftwechsel;quelle\nTESTRAUM;20;0,5;TESTWERT\n",
        "bauteile": "kategorie;bezeichnung;u_wert;quelle\nAußenwand;TESTWAND;0,5;TESTWERT\nFenster;TESTFENSTER;1,3;TESTWERT\n",
    }.items():
        antwort = client.post(f"/api/bibliotheken/{art}/import", files={"datei": (f"{art}.csv", csv.encode())})
        assert antwort.status_code == 200, antwort.text
    klima = client.get("/api/bibliotheken/klimadaten").json()[0]
    raumtyp = client.get("/api/bibliotheken/raumtypen").json()[0]
    bauteile = {b["bezeichnung"]: b["id"] for b in client.get("/api/bibliotheken/bauteile").json()}

    projekt = _post(client, "/api/projekte", {"nummer": "T-1", "bezeichnung": "Testprojekt"})
    objekt = _post(client, f"/api/projekte/{projekt['id']}/objekte",
                   {"bezeichnung": "Testhaus", "klimadaten_id": klima["id"], "delta_u_wb": 0.05})
    geschoss = _post(client, f"/api/objekte/{objekt['id']}/geschosse", {"bezeichnung": "EG"})
    raum = _post(client, f"/api/geschosse/{geschoss['id']}/raeume",
                 {"bezeichnung": "Wohnen", "raumtyp_id": raumtyp["id"], "flaeche_m2": 20, "hoehe_m": 2.5})
    wand = _post(client, f"/api/raeume/{raum['id']}/flaechen",
                 {"bezeichnung": "AW Süd", "bauteil_id": bauteile["TESTWAND"], "flaeche_brutto_m2": 12.5,
                  "orientierung": "S", "angrenzung": "aussen"})
    _post(client, f"/api/flaechen/{wand['id']}/oeffnungen",
          {"bezeichnung": "Fenster", "bauteil_id": bauteile["TESTFENSTER"], "flaeche_m2": 2})
    return {"objekt": objekt, "raum": raum, "wand": wand}


def test_berechnung_versioniert(client, testobjekt):
    objekt_id = testobjekt["objekt"]["id"]
    erste = _post(client, f"/api/objekte/{objekt_id}/berechnungen", {"bemerkung": "erster Lauf"})
    assert erste["version"] == 1
    assert erste["ergebnis"]["summe"]["phi_hl_w"] == pytest.approx(509.25)
    assert erste["eingaben"]["theta_e_c"] == -10
    assert erste["eingaben"]["herkunft"]["klimadaten"]["quelle"] == "TESTWERT"

    # Änderung → neue Version, alte bleibt unverändert
    client.patch(f"/api/raeume/{testobjekt['raum']['id']}", json={"theta_int": 24})
    zweite = _post(client, f"/api/objekte/{objekt_id}/berechnungen", {})
    assert zweite["version"] == 2
    assert zweite["ergebnis"]["summe"]["phi_hl_w"] == pytest.approx((8.475 + 8.5) * 34)
    assert client.get(f"/api/berechnungen/{erste['id']}").json()["ergebnis"]["summe"]["phi_hl_w"] == pytest.approx(509.25)
    assert [b["version"] for b in client.get(f"/api/objekte/{objekt_id}/berechnungen").json()] == [2, 1]


def test_berechnung_meldet_fehlende_kennwerte(client, testobjekt):
    objekt_id = testobjekt["objekt"]["id"]
    client.patch(f"/api/objekte/{objekt_id}", json={"delta_u_wb": None, "klimadaten_id": None})
    client.patch(f"/api/flaechen/{testobjekt['wand']['id']}", json={"bauteil_id": None, "angrenzung": "erdreich"})
    antwort = client.post(f"/api/objekte/{objekt_id}/berechnungen", json={})
    assert antwort.status_code == 422
    fehler = antwort.json()["detail"]["fehler"]
    assert any("Klimadaten" in f for f in fehler)
    assert any("ΔU_WB" in f for f in fehler)
    assert any("kein U-Wert" in f for f in fehler)


def test_rechenkern_fehler_wird_gemeldet(client, testobjekt):
    # Erdreich ohne f: Backend gibt weiter, Rechenkern lehnt ab
    client.patch(f"/api/flaechen/{testobjekt['wand']['id']}", json={"angrenzung": "erdreich"})
    antwort = client.post(f"/api/objekte/{testobjekt['objekt']['id']}/berechnungen", json={})
    assert antwort.status_code == 422
    assert "f_korrektur" in antwort.json()["detail"]["fehler"][0]


def test_bibliothekseintrag_in_verwendung_nicht_loeschbar(client, db, testobjekt):
    from sqlalchemy.exc import IntegrityError

    from app.models import BibKlimadaten

    db.delete(db.query(BibKlimadaten).one())
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_loeschen_kaskadiert(client, testobjekt):
    projekt_id = testobjekt["objekt"]["projekt_id"]
    assert client.delete(f"/api/projekte/{projekt_id}").status_code == 204
    assert client.get(f"/api/raeume/{testobjekt['raum']['id']}").status_code == 404
