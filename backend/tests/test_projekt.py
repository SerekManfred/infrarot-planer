"""Projekte, Schnellerfassung, Heizlastquellen, Fachvorgaben, Projektstatus und Protokoll.

Alle Zahlen sind TESTWERTE (Fantasiewerte). Vorgaben der Testdatenbank (conftest):
Rückfall Neubau 45 W/m², Effizienzhaus-Sanierung 75 W/m², sonstiger Bestand leer, Grenzhöhe 2,90 m, ΔU_WB 0,05.
"""
import pytest

from tests.conftest import anmelden


def _post(client, url, daten):
    antwort = client.post(url, json=daten)
    assert antwort.status_code == 201, antwort.text
    return antwort.json()


def _patch(client, url, daten):
    antwort = client.patch(url, json=daten)
    assert antwort.status_code == 200, antwort.text
    return antwort.json()


@pytest.fixture
def projekt(client, aussendienst):
    """Neubau-Projekt mit Erdgeschoss, angelegt vom Außendienst."""
    anmelden(client, aussendienst.email)
    p = _post(client, "/api/projekte", {"nummer": "T-1", "bezeichnung": "Testprojekt", "gebaeudestandard": "neubau"})
    objekt = p["objekte"][0]
    geschoss = _post(client, f"/api/objekte/{objekt['id']}/geschosse", {"bezeichnung": "EG"})
    return {"projekt": p, "objekt": objekt, "geschoss": geschoss}


def _raum(client, projekt, **daten):
    werte = {"bezeichnung": "Raum", "laenge_m": 4, "breite_m": 5, "hoehe_m": 2.5} | daten
    return _post(client, f"/api/geschosse/{projekt['geschoss']['id']}/raeume", werte)


def _auswertung(client, projekt):
    antwort = client.get(f"/api/objekte/{projekt['objekt']['id']}/auswertung")
    assert antwort.status_code == 200, antwort.text
    return antwort.json()


def _raumtyp(client, fachpruefer, **daten):
    anmelden(client, fachpruefer.email)
    return _post(client, "/api/fachvorgaben/raumtypen", {"bezeichnung": "TESTRAUM"} | daten)


# ── Projekt und Schnellerfassung ────────────────────────────────────────────


def test_projekt_braucht_gebaeudestandard(client, aussendienst):
    anmelden(client, aussendienst.email)
    assert client.post("/api/projekte", json={"nummer": "X", "bezeichnung": "X"}).status_code == 422
    p = _post(client, "/api/projekte", {"nummer": "X", "bezeichnung": "X", "gebaeudestandard": "sonstiger_bestand"})
    assert p["status"] == "entwurf"
    assert p["objekte"][0]["gebaeudestandard"] == "sonstiger_bestand"
    assert client.post("/api/projekte", json={"nummer": "X", "bezeichnung": "Y", "gebaeudestandard": "neubau"}).status_code == 409


def test_flaeche_aus_laenge_mal_breite(client, projekt):
    raum = _raum(client, projekt, laenge_m=4.5, breite_m=3)
    assert raum["flaeche_m2"] == pytest.approx(13.5)
    raum = _patch(client, f"/api/raeume/{raum['id']}", {"laenge_m": 5})
    assert raum["flaeche_m2"] == pytest.approx(15)


# ── Quelle A ────────────────────────────────────────────────────────────────


def test_quelle_a_rueckfallwert_ohne_raumtyp(client, projekt):
    _raum(client, projekt)
    r = _auswertung(client, projekt)["raeume"][0]
    assert r["werte"]["pauschale_w_m2"] == {"wert": 45, "herkunft": "rueckfall"}
    assert r["phi_massgeblich_w"] == pytest.approx(45 * 20)
    assert r["hinweise"] == []


def test_quelle_a_herkunft_vorgabe_projekt_raum(client, projekt, aussendienst, fachpruefer):
    typ = _raumtyp(client, fachpruefer)
    client.put("/api/fachvorgaben/pauschalen", json={"raumtyp_id": typ["id"], "gebaeudestandard": "neubau", "w_m2": 33, "quelle": "TESTWERT"})
    anmelden(client, aussendienst.email)
    raum = _raum(client, projekt, raumtyp_id=typ["id"])
    assert _auswertung(client, projekt)["raeume"][0]["werte"]["pauschale_w_m2"] == {"wert": 33, "herkunft": "vorgabe"}

    _patch(client, f"/api/objekte/{projekt['objekt']['id']}", {"pauschale_abweichungen": {str(typ["id"]): 36}})
    assert _auswertung(client, projekt)["raeume"][0]["werte"]["pauschale_w_m2"] == {"wert": 36, "herkunft": "projekt"}

    _patch(client, f"/api/raeume/{raum['id']}", {"pauschale_w_m2": 39})
    r = _auswertung(client, projekt)["raeume"][0]
    assert r["werte"]["pauschale_w_m2"] == {"wert": 39, "herkunft": "raum"}
    assert r["phi_a_w"] == pytest.approx(39 * 20)


def test_sonstiger_bestand_hinweis_und_vorgabe_fehlt(client, aussendienst):
    anmelden(client, aussendienst.email)
    p = _post(client, "/api/projekte", {"nummer": "B-1", "bezeichnung": "Altbau", "gebaeudestandard": "sonstiger_bestand"})
    objekt_id = p["objekte"][0]["id"]
    geschoss = _post(client, f"/api/objekte/{objekt_id}/geschosse", {"bezeichnung": "EG"})
    _post(client, f"/api/geschosse/{geschoss['id']}/raeume", {"bezeichnung": "Wohnen", "laenge_m": 4, "breite_m": 5})
    a = client.get(f"/api/objekte/{objekt_id}/auswertung").json()
    assert a["hinweise"] == ["Infrarot als alleiniges Heizsystem wird für diesen Gebäudestandard nicht empfohlen."]
    r = a["raeume"][0]
    assert r["phi_massgeblich_w"] is None
    assert r["werte"]["pauschale_w_m2"]["herkunft"] == "fehlt"
    assert r["hinweise"][0].startswith("Vorgabe fehlt: Pauschale")
    assert a["summe"]["raeume_ohne_ergebnis"] == 1


def test_hoehenzuschlag(client, projekt, aussendienst, fachpruefer):
    _raum(client, projekt, hoehe_m=3.4)
    r = _auswertung(client, projekt)["raeume"][0]
    # Raum über der Grenzhöhe, aber Zuschlag in % je m nicht gepflegt
    assert r["phi_a_w"] == pytest.approx(45 * 20)
    assert any("Höhenzuschlag" in h and "2,90 m" in h for h in r["hinweise"])

    anmelden(client, fachpruefer.email)
    werte = client.get("/api/fachvorgaben").json()["werte"]
    werte["hoehenzuschlag_prozent_je_m"] = 20
    assert client.put("/api/fachvorgaben/werte", json=werte).status_code == 200
    anmelden(client, aussendienst.email)
    r = _auswertung(client, projekt)["raeume"][0]
    # (3,4 − 2,9) m · 20 %/m = 10 %
    assert r["phi_a_w"] == pytest.approx(45 * 20 * 1.10)
    assert r["hinweise"] == []

    # Projektabweichung der Grenzhöhe
    _patch(client, f"/api/objekte/{projekt['objekt']['id']}", {"hoehenzuschlag_grenzhoehe_m": 3.4})
    a = _auswertung(client, projekt)
    assert a["vorgaben"]["hoehenzuschlag_grenzhoehe_m"] == {"wert": 3.4, "herkunft": "projekt"}
    assert a["raeume"][0]["phi_a_w"] == pytest.approx(45 * 20)


# ── Quellen B und C ─────────────────────────────────────────────────────────


def test_quelle_b(client, projekt):
    raum = _raum(client, projekt, heizlastquelle="B")
    r = _auswertung(client, projekt)["raeume"][0]
    assert r["phi_massgeblich_w"] is None
    assert "Hottgenroth" in r["hinweise"][0]
    _patch(client, f"/api/raeume/{raum['id']}", {"hottgenroth_w": 777})
    r = _auswertung(client, projekt)["raeume"][0]
    assert r["phi_massgeblich_w"] == 777
    assert r["phi_a_w"] == pytest.approx(900)


@pytest.fixture
def gegenprobe(client, projekt, aussendienst, fachpruefer):
    """Raum mit Raumtyp, Außenwand und Fenster für Quelle C (alles TESTWERTE)."""
    typ = _raumtyp(client, fachpruefer, theta_int=20, luftwechsel=0.5)
    keller = _post(client, "/api/fachvorgaben/raumtypen", {"bezeichnung": "TESTKELLER"})
    csv = {
        "klimadaten": "plz;ort;theta_e;quelle\n00000;TESTORT;-10;TESTWERT\n",
        "bauteile": "kategorie;bezeichnung;u_wert;quelle\nAußenwand;TESTWAND;0,5;TESTWERT\nFenster;TESTFENSTER;1,3;TESTWERT\nKellerdecke;TESTDECKE;1,0;TESTWERT\n",
    }
    for art, inhalt in csv.items():
        assert client.post(f"/api/bibliotheken/{art}/import", files={"datei": ("x.csv", inhalt.encode())}).status_code == 200
    klima = client.get("/api/bibliotheken/klimadaten").json()[0]
    bauteile = {b["bezeichnung"]: b["id"] for b in client.get("/api/bibliotheken/bauteile").json()}

    anmelden(client, aussendienst.email)
    _patch(client, f"/api/objekte/{projekt['objekt']['id']}", {"klimadaten_id": klima["id"]})
    raum = _raum(client, projekt, raumtyp_id=typ["id"])  # 4 × 5 × 2,5 m
    wand = _post(client, f"/api/raeume/{raum['id']}/flaechen", {
        "bezeichnung": "AW Süd", "bauteil_id": bauteile["TESTWAND"], "flaeche_brutto_m2": 12.5, "angrenzung": "aussen"})
    _post(client, f"/api/flaechen/{wand['id']}/oeffnungen", {"bezeichnung": "Fenster", "bauteil_id": bauteile["TESTFENSTER"], "flaeche_m2": 2})
    return {"raum": raum, "keller": keller, "bauteile": bauteile}


def test_quelle_c_gegenprobe_mit_abweichung(client, projekt, gegenprobe):
    r = _auswertung(client, projekt)["raeume"][0]
    # Wie im Rechenkern-Test: H_T = 8,475 W/K, H_V = 8,5 W/K, Δθ = 30 K → Φ_C = 509,25 W
    assert r["phi_c_w"] == pytest.approx(509.25)
    assert r["phi_massgeblich_w"] == pytest.approx(900)  # Quelle A: 45 W/m² · 20 m²
    assert r["abweichung_c"] == pytest.approx(509.25 / 900 - 1)
    assert r["werte"]["theta_int"] == {"wert": 20, "herkunft": "vorgabe"}


def test_quelle_c_reduktionsfaktor_des_angrenzenden_raumtyps(client, projekt, gegenprobe, aussendienst, fachpruefer):
    decke = _post(client, f"/api/raeume/{gegenprobe['raum']['id']}/flaechen", {
        "bezeichnung": "Kellerdecke", "bauteil_id": gegenprobe["bauteile"]["TESTDECKE"], "flaeche_brutto_m2": 20,
        "angrenzung": "unbeheizt", "angrenzender_raumtyp_id": gegenprobe["keller"]["id"]})
    r = _auswertung(client, projekt)["raeume"][0]
    assert r["phi_c_w"] is None
    assert any("Reduktionsfaktor" in h and "TESTKELLER" in h for h in r["hinweise"])

    anmelden(client, fachpruefer.email)
    _patch(client, f"/api/fachvorgaben/raumtypen/{gegenprobe['keller']['id']}", {"reduktionsfaktor": 0.5})
    anmelden(client, aussendienst.email)
    r = _auswertung(client, projekt)["raeume"][0]
    # Kellerdecke: 20 m² · (1,0 + 0,05) · 0,5 · 30 K = 315 W zusätzlich
    assert r["phi_c_w"] == pytest.approx(509.25 + 315)
    assert decke["angrenzender_raumtyp_id"] == gegenprobe["keller"]["id"]


def test_quelle_c_als_massgeblich(client, projekt, gegenprobe):
    _patch(client, f"/api/raeume/{gegenprobe['raum']['id']}", {"heizlastquelle": "C"})
    r = _auswertung(client, projekt)["raeume"][0]
    assert r["phi_massgeblich_w"] == pytest.approx(509.25)
    assert r["abweichung_c"] is None


def test_raum_ohne_bauteile_ohne_gegenprobe(client, projekt):
    _raum(client, projekt)
    r = _auswertung(client, projekt)["raeume"][0]
    assert r["phi_c_w"] is None
    assert r["hinweise"] == []


# ── Status, Sperre, Protokoll ───────────────────────────────────────────────


def test_statusablauf(client, db, projekt, aussendienst, fachpruefer, admin):
    pid = projekt["projekt"]["id"]
    raum = _raum(client, projekt)

    assert client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"}).status_code == 403
    anmelden(client, admin.email)
    assert client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"}).status_code == 403

    anmelden(client, fachpruefer.email)
    assert client.post(f"/api/projekte/{pid}/status", json={"status": "freigegeben"}).status_code == 409
    geprueft = client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"}).json()
    assert geprueft["status"] == "geprueft"
    assert geprueft["geprueft_von_id"] == fachpruefer.id

    # Änderung nach der Prüfung → zurück auf Entwurf
    anmelden(client, aussendienst.email)
    _patch(client, f"/api/raeume/{raum['id']}", {"laenge_m": 6})
    assert client.get(f"/api/projekte/{pid}").json()["status"] == "entwurf"

    anmelden(client, fachpruefer.email)
    client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"})
    frei = client.post(f"/api/projekte/{pid}/status", json={"status": "freigegeben", "bemerkung": "ok"}).json()
    assert frei["status"] == "freigegeben"

    # Freigabe friert die Auswertung als Berechnung ein
    berechnungen = client.get(f"/api/objekte/{projekt['objekt']['id']}/berechnungen").json()
    assert len(berechnungen) == 1 and berechnungen[0]["bemerkung"] == "Freigabe ok"
    eingefroren = client.get(f"/api/berechnungen/{berechnungen[0]['id']}").json()
    assert eingefroren["ergebnis"]["summe"]["phi_massgeblich_w"] == pytest.approx(45 * 30)

    # Freigegeben = gesperrt, für alle
    for email in (aussendienst.email, fachpruefer.email):
        anmelden(client, email)
        assert client.patch(f"/api/raeume/{raum['id']}", json={"laenge_m": 7}).status_code == 409
        assert client.post(f"/api/geschosse/{projekt['geschoss']['id']}/raeume", json={"bezeichnung": "Neu"}).status_code == 409
        assert client.delete(f"/api/raeume/{raum['id']}").status_code == 409

    # Nur der Fachprüfer kann zurück auf Entwurf setzen
    assert client.post(f"/api/projekte/{pid}/status", json={"status": "entwurf"}).json()["status"] == "entwurf"
    _patch(client, f"/api/raeume/{raum['id']}", {"laenge_m": 7})


def test_protokoll(client, projekt, aussendienst, fachpruefer):
    pid = projekt["projekt"]["id"]
    raum = _raum(client, projekt, bezeichnung="Küche")
    _patch(client, f"/api/raeume/{raum['id']}", {"laenge_m": 6})
    anmelden(client, fachpruefer.email)
    client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"})

    eintraege = client.get(f"/api/projekte/{pid}/protokoll").json()
    neueste = eintraege[0]
    assert (neueste["objektart"], neueste["aktion"], neueste["benutzer_name"]) == ("Projekt", "geaendert", "fachpruefer")
    assert neueste["aenderungen"]["status"] == ["entwurf", "geprueft"]
    # Statuswechsel samt Prüfer und Zeitpunkt in einem Eintrag
    assert neueste["aenderungen"]["geprueft_von_id"] == [None, fachpruefer.id]

    aenderung = next(e for e in eintraege if e["objektart"] == "Raum" and e["aktion"] == "geaendert")
    assert aenderung["benutzer_name"] == "aussendienst"
    assert aenderung["aenderungen"]["laenge_m"] == [4, 6]
    assert aenderung["aenderungen"]["flaeche_m2"] == [20, 30]
    assert {(e["objektart"], e["aktion"]) for e in eintraege} >= {
        ("Projekt", "angelegt"), ("Objekt", "angelegt"), ("Geschoss", "angelegt"), ("Raum", "angelegt")}
    assert all(e["zeitpunkt"] for e in eintraege)


def test_protokoll_fachvorgaben(client, fachpruefer):
    anmelden(client, fachpruefer.email)
    werte = client.get("/api/fachvorgaben").json()["werte"]
    werte["rueckfall_sonstiger_bestand_w_m2"] = 99
    client.put("/api/fachvorgaben/werte", json=werte)
    eintrag = client.get("/api/fachvorgaben/protokoll").json()[0]
    assert eintrag["objektart"] == "Fachvorgaben"
    assert eintrag["benutzer_name"] == "fachpruefer"
    assert eintrag["aenderungen"]["rueckfall_sonstiger_bestand_w_m2"] == [None, 99]


def test_pauschale_entfernen_und_raumtyp_in_verwendung(client, projekt, aussendienst, fachpruefer):
    typ = _raumtyp(client, fachpruefer)
    client.put("/api/fachvorgaben/pauschalen", json={"raumtyp_id": typ["id"], "gebaeudestandard": "neubau", "w_m2": 33})
    assert len(client.get("/api/fachvorgaben").json()["pauschalen"]) == 1
    client.put("/api/fachvorgaben/pauschalen", json={"raumtyp_id": typ["id"], "gebaeudestandard": "neubau", "w_m2": None})
    assert client.get("/api/fachvorgaben").json()["pauschalen"] == []

    anmelden(client, aussendienst.email)
    _raum(client, projekt, raumtyp_id=typ["id"])
    anmelden(client, fachpruefer.email)
    assert client.delete(f"/api/fachvorgaben/raumtypen/{typ['id']}").status_code == 409


def test_berechnung_versioniert(client, projekt):
    _raum(client, projekt)
    oid = projekt["objekt"]["id"]
    eins = _post(client, f"/api/objekte/{oid}/berechnungen", {"bemerkung": "erster Stand"})
    zwei = _post(client, f"/api/objekte/{oid}/berechnungen", {})
    assert (eins["version"], zwei["version"]) == (1, 2)
    assert eins["eingaben"]["art"] == "objekt"


def test_loeschen_nur_admin_und_kaskadiert(client, db, projekt, admin):
    raum = _raum(client, projekt)
    pid = projekt["projekt"]["id"]
    assert client.delete(f"/api/projekte/{pid}").status_code == 403
    anmelden(client, admin.email)
    assert client.delete(f"/api/projekte/{pid}").status_code == 204
    assert client.get(f"/api/raeume/{raum['id']}").status_code == 404
    # Protokoll bleibt erhalten, inklusive Löscheintrag
    from sqlalchemy import select

    from app.models import Protokoll

    aktionen = db.scalars(select(Protokoll.aktion).where(Protokoll.projekt_id == pid)).all()
    assert "angelegt" in aktionen and "geloescht" in aktionen
