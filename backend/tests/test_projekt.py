"""Projekte, Schnellerfassung, Heizlastquellen, Fachvorgaben, Projektstatus und Protokoll.

Alle Zahlen sind TESTWERTE (Fantasiewerte). Vorgaben der Testdatenbank (conftest):
Rückfall Neubau 45 W/m², Effizienzhaus-Sanierung 75 W/m², Hinweis-Höhe 2,90 m, ΔU_WB 0,05.

Projekte rechnen mit ihrer beim Anlegen eingefrorenen Kopie der Fachvorgaben. Ändern Tests die zentralen Vorgaben
nach dem Anlegen, übernehmen sie diese ausdrücklich (_uebernehmen).
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


def _uebernehmen(client, projekt, benutzer):
    """Aktuelle zentrale Fachvorgaben ins Projekt übernehmen (wie der Klick in der Oberfläche; nur Fachprüfer)."""
    anmelden(client, benutzer.email)
    antwort = client.post(f"/api/projekte/{projekt['projekt']['id']}/vorgaben/uebernehmen")
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
    # Projektnummer vergibt der Server; eine mitgeschickte Nummer wird ignoriert
    assert p["nummer"] != "X"
    assert _post(client, "/api/projekte", {"nummer": "X", "bezeichnung": "Y", "gebaeudestandard": "neubau"})["nummer"] != p["nummer"]


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
    _uebernehmen(client, projekt, fachpruefer)
    raum = _raum(client, projekt, raumtyp_id=typ["id"])
    assert _auswertung(client, projekt)["raeume"][0]["werte"]["pauschale_w_m2"] == {"wert": 33, "herkunft": "vorgabe"}

    # W/m² setzt nur der Fachprüfer
    anmelden(client, fachpruefer.email)
    _patch(client, f"/api/objekte/{projekt['objekt']['id']}", {"pauschale_abweichungen": {str(typ["id"]): 36}})
    assert _auswertung(client, projekt)["raeume"][0]["werte"]["pauschale_w_m2"] == {"wert": 36, "herkunft": "projekt"}

    _patch(client, f"/api/raeume/{raum['id']}", {"pauschale_w_m2": 39})
    r = _auswertung(client, projekt)["raeume"][0]
    assert r["werte"]["pauschale_w_m2"] == {"wert": 39, "herkunft": "raum"}
    assert r["phi_a_w"] == pytest.approx(39 * 20)


def test_sonstiger_bestand_pauschale_je_raum_pflicht(client, aussendienst, fachpruefer):
    anmelden(client, fachpruefer.email)
    typ = _post(client, "/api/fachvorgaben/raumtypen", {"bezeichnung": "TESTRAUM"})
    # keine Tabellenwerte für „sonstiger Bestand“
    antwort = client.put("/api/fachvorgaben/pauschalen", json={"raumtyp_id": typ["id"], "gebaeudestandard": "sonstiger_bestand", "w_m2": 99})
    assert antwort.status_code == 422
    assert "je Raum" in antwort.json()["detail"]

    anmelden(client, aussendienst.email)
    p = _post(client, "/api/projekte", {"nummer": "B-1", "bezeichnung": "Altbau", "gebaeudestandard": "sonstiger_bestand"})
    objekt_id = p["objekte"][0]["id"]
    geschoss = _post(client, f"/api/objekte/{objekt_id}/geschosse", {"bezeichnung": "EG"})
    raum = _post(client, f"/api/geschosse/{geschoss['id']}/raeume", {"bezeichnung": "Wohnen", "laenge_m": 4, "breite_m": 5, "raumtyp_id": typ["id"]})
    a = client.get(f"/api/objekte/{objekt_id}/auswertung").json()
    assert a["hinweise"] == ["Infrarot als alleiniges Heizsystem wird für diesen Gebäudestandard nicht empfohlen."]
    r = a["raeume"][0]
    assert r["phi_massgeblich_w"] is None
    assert r["werte"]["pauschale_w_m2"]["herkunft"] == "fehlt"
    assert r["hinweise"] == ["Eingabe fehlt: Pauschale W/m² für diesen Raum – wird bei „Altbau (nicht Effizienzhaus)“ vom Fachprüfer festgelegt"]
    assert a["vorgaben"]["rueckfall_w_m2"] == {"wert": None, "herkunft": "fehlt"}

    anmelden(client, fachpruefer.email)
    _patch(client, f"/api/raeume/{raum['id']}", {"pauschale_w_m2": 110})
    r = client.get(f"/api/objekte/{objekt_id}/auswertung").json()["raeume"][0]
    assert r["phi_massgeblich_w"] == pytest.approx(2200)
    assert r["hinweise"] == []


# ── W/m² nur durch Fachprüfer, Altbau wartet auf Fachprüfer (Festlegung 13.10.2026) ──


def test_pauschale_setzt_nur_fachpruefer(client, projekt, aussendienst, fachpruefer, admin):
    raum = _raum(client, projekt)
    objekt_url = f"/api/objekte/{projekt['objekt']['id']}"
    for benutzer in (aussendienst, admin):
        anmelden(client, benutzer.email)
        antwort = client.patch(f"/api/raeume/{raum['id']}", json={"pauschale_w_m2": 50})
        assert antwort.status_code == 403
        assert "Fachprüfer" in antwort.json()["detail"]
        assert client.patch(objekt_url, json={"pauschale_abweichungen": {"1": 50}}).status_code == 403
        antwort = client.post(f"/api/geschosse/{projekt['geschoss']['id']}/raeume", json={"bezeichnung": "X", "pauschale_w_m2": 50})
        assert antwort.status_code == 403
    # andere Felder und unveränderte Werte bleiben erlaubt (z. B. wenn das Tablet den ganzen Datensatz schickt)
    anmelden(client, aussendienst.email)
    _patch(client, f"/api/raeume/{raum['id']}", {"laenge_m": 6, "pauschale_w_m2": None})
    _patch(client, objekt_url, {"pauschale_abweichungen": {}})

    anmelden(client, fachpruefer.email)
    assert _patch(client, f"/api/raeume/{raum['id']}", {"pauschale_w_m2": 50})["pauschale_w_m2"] == 50
    assert _patch(client, objekt_url, {"pauschale_abweichungen": {"1": 44}})["pauschale_abweichungen"] == {"1": 44}


def test_altbau_wartet_auf_fachpruefer(client, aussendienst, fachpruefer):
    anmelden(client, aussendienst.email)
    p = _post(client, "/api/projekte", {"nummer": "A-1", "bezeichnung": "Altbau", "gebaeudestandard": "sonstiger_bestand"})
    assert p["wartet_auf_fachpruefer"] is False  # noch keine Räume
    objekt_id = p["objekte"][0]["id"]
    geschoss = _post(client, f"/api/objekte/{objekt_id}/geschosse", {"bezeichnung": "EG"})
    raum = _post(client, f"/api/geschosse/{geschoss['id']}/raeume", {"bezeichnung": "Wohnen", "laenge_m": 4, "breite_m": 5})
    assert client.get(f"/api/projekte/{p['id']}").json()["wartet_auf_fachpruefer"] is True
    assert [x["wartet_auf_fachpruefer"] for x in client.get("/api/projekte").json()] == [True]

    # Prüfen (und damit Freigabe und Angebot) erst, wenn der Fachprüfer die Werte gesetzt hat
    anmelden(client, fachpruefer.email)
    antwort = client.post(f"/api/projekte/{p['id']}/status", json={"status": "geprueft"})
    assert antwort.status_code == 409
    assert "W/m²" in antwort.json()["detail"]
    _patch(client, f"/api/raeume/{raum['id']}", {"pauschale_w_m2": 120})
    assert client.get(f"/api/projekte/{p['id']}").json()["wartet_auf_fachpruefer"] is False
    assert client.post(f"/api/projekte/{p['id']}/status", json={"status": "geprueft"}).status_code == 200

    # neuer Raum ohne Wert: wartet wieder (und das Projekt fällt auf Entwurf zurück)
    anmelden(client, aussendienst.email)
    _post(client, f"/api/geschosse/{geschoss['id']}/raeume", {"bezeichnung": "Bad", "laenge_m": 2, "breite_m": 2})
    p = client.get(f"/api/projekte/{p['id']}").json()
    assert (p["status"], p["wartet_auf_fachpruefer"]) == ("entwurf", True)


def test_neubau_wartet_nie(client, projekt):
    _raum(client, projekt)
    assert client.get(f"/api/projekte/{projekt['projekt']['id']}").json()["wartet_auf_fachpruefer"] is False


def test_hohe_raeume_nur_hinweis_kein_zuschlag(client, projekt, fachpruefer):
    raum = _raum(client, projekt, hoehe_m=3.4)
    r = _auswertung(client, projekt)["raeume"][0]
    assert r["phi_a_w"] == pytest.approx(45 * 20)
    assert r["hinweise"] == ["Raumhöhe über 2,90 m – Pauschale prüfen und ggf. manuell anpassen."]
    assert "hoehenzuschlag_faktor" not in (r["pauschal"] or {})
    # nach manueller Anpassung (durch den Fachprüfer) kein Hinweis mehr
    anmelden(client, fachpruefer.email)
    _patch(client, f"/api/raeume/{raum['id']}", {"pauschale_w_m2": 50})
    r = _auswertung(client, projekt)["raeume"][0]
    assert r["phi_a_w"] == pytest.approx(50 * 20)
    assert r["hinweise"] == []


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

    _uebernehmen(client, projekt, fachpruefer)
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
    # erst nach der Übernahme wirkt der neue Reduktionsfaktor im Projekt
    anmelden(client, aussendienst.email)
    assert _auswertung(client, projekt)["raeume"][0]["phi_c_w"] is None
    _uebernehmen(client, projekt, fachpruefer)
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
    werte["hoehe_hinweis_m"] = 3.0
    client.put("/api/fachvorgaben/werte", json=werte)
    eintrag = client.get("/api/fachvorgaben/protokoll").json()[0]
    assert eintrag["objektart"] == "Fachvorgaben"
    assert eintrag["benutzer_name"] == "fachpruefer"
    assert eintrag["aenderungen"]["hoehe_hinweis_m"] == [2.9, 3.0]


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


# ── Sperrflächen und Module je Raum (Festlegung 14.10.2026) ──


def test_sperrflaechen_und_module_speichern_und_auswerten(client, projekt, fachpruefer):
    anmelden(client, fachpruefer.email)
    for schluessel, wert in (("abstand_wand_cm", 50), ("abstand_modul_cm", 40), ("abstand_sitzplatz_cm", 30),
                             ("leistungsreserve_prozent", 10), ("ueberdimensionierung_prozent", 20)):
        client.patch(f"/api/fachvorgaben/regeln/{schluessel}", json={"wert": wert, "quelle": "TESTWERT"})
    client.patch("/api/fachvorgaben/regeln/thermostat_je_raum", json={"wert_text": "ja", "quelle": "TESTWERT"})
    _uebernehmen(client, projekt, fachpruefer)
    raum = _raum(client, projekt)  # 4 × 5 m, Rückfall 45 W/m² → 900 W, benötigt 990 W
    sitz = {"id": "s1", "typ": "sitzplatz", "x": 0.5, "y": 0.5, "b": 1.5, "t": 1.0}
    modul = {"id": "m1", "modul_id": None, "artikel_nr": "T-1", "bezeichnung": "TESTMODUL", "leistung_w": 1000,
             "laenge_m": 1.0, "breite_m": 0.8, "schutzart": "IP44", "bad_geeignet": True, "x": 1.0, "y": 0.7,
             "gedreht": False}
    # Außendienst darf Sperrflächen und Module setzen (Vor-Ort-Planung)
    anmelden(client, "aussendienst@test.invalid")
    r = _patch(client, f"/api/raeume/{raum['id']}", {"sperrflaechen": [sitz], "module": [modul]})
    assert r["sperrflaechen"][0]["typ"] == "sitzplatz" and r["module"][0]["artikel_nr"] == "T-1"

    m = _auswertung(client, projekt)["raeume"][0]["modulplanung"]
    assert m["benoetigt_w"] == pytest.approx(990) and m["installiert_w"] == 1000 and m["thermostate"] == 1
    assert m["verstoesse"]["m1"] == ["liegt über einem Sitzplatz – über Sitzplätzen und Betten unzulässig"]
    a = _auswertung(client, projekt)
    assert (a["summe"]["module"], a["summe"]["installiert_w"], a["summe"]["thermostate"]) == (1, 1000, 1)

    # ungültige Daten werden abgelehnt
    assert client.patch(f"/api/raeume/{raum['id']}", json={"sperrflaechen": [{**sitz, "typ": "sofa"}]}).status_code == 422
    assert client.patch(f"/api/raeume/{raum['id']}", json={"module": [{**modul, "leistung_w": 0}]}).status_code == 422
    # im Offline-Paket enthalten
    paket = client.get(f"/api/offline/projekte/{projekt['projekt']['id']}").json()
    assert paket["objekte"][0]["geschosse"][0]["raeume"][0]["module"][0]["id"] == "m1"


def test_tueren_und_fenster_ohne_einfluss_auf_die_planung(client, projekt):
    """Tür und Fenster nur zur Orientierung (31.10.2026): gespeichert, im Offline-Paket, Auswertung unverändert."""
    raum = _raum(client, projekt)
    vorher = _auswertung(client, projekt)["raeume"][0]
    tuer = {"id": "t1", "art": "tuer", "wand": "unten", "position": 0.5, "breite": 0.9, "aufschlag": "innen", "band": "links"}
    fenster = {"id": "f1", "art": "fenster", "wand": "oben", "position": 1.5, "breite": 1.2}
    r = _patch(client, f"/api/raeume/{raum['id']}", {"tueren_fenster": [tuer, fenster]})
    assert [o["art"] for o in r["tueren_fenster"]] == ["tuer", "fenster"]
    assert _auswertung(client, projekt)["raeume"][0] == vorher
    paket = client.get(f"/api/offline/projekte/{projekt['projekt']['id']}").json()
    assert paket["objekte"][0]["geschosse"][0]["raeume"][0]["tueren_fenster"][1]["breite"] == 1.2
    assert client.patch(f"/api/raeume/{raum['id']}", json={"tueren_fenster": [{**tuer, "wand": "decke"}]}).status_code == 422
    assert client.patch(f"/api/raeume/{raum['id']}", json={"tueren_fenster": [{**tuer, "breite": 0}]}).status_code == 422


# ── Sichtbarkeit und Projektnummer (Festlegung 31.10.2026) ──


def _projekt_mit_raum(client, bezeichnung):
    p = _post(client, "/api/projekte", {"bezeichnung": bezeichnung, "gebaeudestandard": "neubau"})
    g = _post(client, f"/api/objekte/{p['objekte'][0]['id']}/geschosse", {"bezeichnung": "EG"})
    r = _post(client, f"/api/geschosse/{g['id']}/raeume", {"bezeichnung": "Raum", "laenge_m": 4, "breite_m": 5})
    return p, g, r


def test_aussendienst_a_sieht_keine_projekte_von_b(client, db, aussendienst, fachpruefer, admin):
    from tests.conftest import _benutzer

    b = _benutzer(db, "aussendienst-b@test.invalid", "aussendienst")
    anmelden(client, aussendienst.email)
    pa, ga, ra = _projekt_mit_raum(client, "Projekt von A")
    anmelden(client, b.email)
    pb, gb, rb = _projekt_mit_raum(client, "Projekt von B")

    # B sieht nur sein eigenes Projekt – in der Liste und über jeden Weg der API
    assert [p["bezeichnung"] for p in client.get("/api/projekte").json()] == ["Projekt von B"]
    oid = pa["objekte"][0]["id"]
    for methode, pfad, daten in (
        ("get", f"/api/projekte/{pa['id']}", None),
        ("patch", f"/api/projekte/{pa['id']}", {"bezeichnung": "übernommen"}),
        ("get", f"/api/projekte/{pa['id']}/protokoll", None),
        ("get", f"/api/projekte/{pa['id']}/vorgaben", None),
        ("post", f"/api/projekte/{pa['id']}/auschecken", {"geraet": "Tablet B"}),
        ("post", f"/api/projekte/{pa['id']}/einchecken", None),
        ("get", f"/api/offline/projekte/{pa['id']}", None),
        ("get", f"/api/objekte/{oid}", None),
        ("get", f"/api/objekte/{oid}/geschosse", None),
        ("get", f"/api/objekte/{oid}/auswertung", None),
        ("get", f"/api/objekte/{oid}/berechnungen", None),
        ("post", f"/api/objekte/{oid}/berechnungen", {}),
        ("post", f"/api/objekte/{oid}/geschosse", {"bezeichnung": "OG"}),
        ("get", f"/api/geschosse/{ga['id']}/raeume", None),
        ("post", f"/api/geschosse/{ga['id']}/raeume", {"bezeichnung": "fremd"}),
        ("get", f"/api/raeume/{ra['id']}", None),
        ("patch", f"/api/raeume/{ra['id']}", {"laenge_m": 9}),
        ("delete", f"/api/raeume/{ra['id']}", None),
        ("get", f"/api/raeume/{ra['id']}/flaechen", None),
    ):
        antwort = getattr(client, methode)(pfad, **({"json": daten} if daten is not None else {}))
        assert antwort.status_code == 404, (methode, pfad, antwort.status_code)
        assert "nicht gefunden" in antwort.json()["detail"]
    assert client.get(f"/api/raeume/{ra['id']}").status_code == 404
    # nichts verändert
    anmelden(client, aussendienst.email)
    assert client.get(f"/api/raeume/{ra['id']}").json()["laenge_m"] == 4
    assert [p["bezeichnung"] for p in client.get("/api/projekte").json()] == ["Projekt von A"]

    # Fachprüfer und Admin sehen alle
    for wer in (fachpruefer, admin):
        anmelden(client, wer.email)
        assert sorted(p["bezeichnung"] for p in client.get("/api/projekte").json()) == ["Projekt von A", "Projekt von B"]
        assert client.get(f"/api/raeume/{rb['id']}").status_code == 200


def test_admin_weist_projekt_zu(client, db, aussendienst, admin, fachpruefer):
    from tests.conftest import _benutzer

    vertretung = _benutzer(db, "vertretung@test.invalid", "aussendienst")
    anmelden(client, aussendienst.email)
    p, _g, r = _projekt_mit_raum(client, "Urlaubsprojekt")
    anmelden(client, vertretung.email)
    assert client.get(f"/api/projekte/{p['id']}").status_code == 404

    # nur Admin darf zuweisen, nur an aktive Außendienst-Benutzer
    anmelden(client, aussendienst.email)
    assert client.put(f"/api/projekte/{p['id']}/zuweisung", json={"benutzer_id": vertretung.id}).status_code == 403
    anmelden(client, admin.email)
    assert client.put(f"/api/projekte/{p['id']}/zuweisung", json={"benutzer_id": fachpruefer.id}).status_code == 409
    z = client.put(f"/api/projekte/{p['id']}/zuweisung", json={"benutzer_id": vertretung.id}).json()
    assert (z["zugewiesen_an_name"], z["ersteller_name"]) == (vertretung.name, aussendienst.name)
    eintrag = next(e for e in client.get(f"/api/projekte/{p['id']}/protokoll").json() if "zugewiesen_an_id" in e["aenderungen"])
    assert eintrag["aenderungen"]["zugewiesen_an_id"] == [None, vertretung.id]

    # Vertretung sieht und bearbeitet; Ersteller sieht es weiterhin
    anmelden(client, vertretung.email)
    assert [x["bezeichnung"] for x in client.get("/api/projekte").json()] == ["Urlaubsprojekt"]
    assert client.patch(f"/api/raeume/{r['id']}", json={"laenge_m": 6}).status_code == 200
    assert client.get(f"/api/offline/projekte/{p['id']}").status_code == 200
    anmelden(client, aussendienst.email)
    assert client.get(f"/api/projekte/{p['id']}").status_code == 200

    # Zuweisung aufheben
    anmelden(client, admin.email)
    client.put(f"/api/projekte/{p['id']}/zuweisung", json={"benutzer_id": None})
    anmelden(client, vertretung.email)
    assert client.get("/api/projekte").json() == []


def test_projektnummer_automatisch_und_nur_admin_aendert(client, aussendienst, admin):
    from datetime import UTC, datetime

    jahr = datetime.now(UTC).year
    anmelden(client, aussendienst.email)
    erste = _post(client, "/api/projekte", {"bezeichnung": "A", "gebaeudestandard": "neubau"})
    zweite = _post(client, "/api/projekte", {"bezeichnung": "B", "gebaeudestandard": "neubau"})
    assert (erste["nummer"], zweite["nummer"]) == (f"{jahr}-0001", f"{jahr}-0002")

    antwort = client.patch(f"/api/projekte/{erste['id']}", json={"nummer": "frei-1"})
    assert antwort.status_code == 403 and "nur ein Admin" in antwort.json()["detail"]
    assert client.patch(f"/api/projekte/{erste['id']}", json={"bezeichnung": "A2", "nummer": erste["nummer"]}).status_code == 200

    anmelden(client, admin.email)
    antwort = client.patch(f"/api/projekte/{erste['id']}", json={"nummer": zweite["nummer"]})
    assert antwort.status_code == 409
    assert antwort.json()["detail"] == f"Projektnummer {zweite['nummer']} ist bereits vergeben"
    assert _patch(client, f"/api/projekte/{erste['id']}", {"nummer": f"{jahr}-0050"})["nummer"] == f"{jahr}-0050"
    # die Zählung setzt hinter der höchsten Nummer fort
    assert _post(client, "/api/projekte", {"bezeichnung": "C", "gebaeudestandard": "neubau"})["nummer"] == f"{jahr}-0051"


def test_verstaendliche_fehlermeldungen(client, aussendienst, admin):
    anmelden(client, aussendienst.email)
    antwort = client.post("/api/projekte", json={"bezeichnung": "", "gebaeudestandard": "villa"})
    assert antwort.status_code == 422
    assert antwort.json()["detail"] == "Bitte Eingaben prüfen: Bezeichnung darf nicht leer sein; Gebäudestandard ist keine gültige Auswahl."
    p, _g, r = _projekt_mit_raum(client, "X")
    antwort = client.patch(f"/api/raeume/{r['id']}", json={"laenge_m": 500})
    assert antwort.json()["detail"] == "Bitte Eingaben prüfen: Länge darf höchstens 100 sein."
    assert client.get("/api/raeume/999999").json()["detail"] == "Raum nicht gefunden – evtl. inzwischen gelöscht"
    anmelden(client, admin.email)
    neu = {"email": aussendienst.email, "name": "Doppelt", "rollen": ["aussendienst"], "passwort": "x" * 12}
    antwort = client.post("/api/benutzer", json=neu)
    assert antwort.status_code == 409 and antwort.json()["detail"] == f"Die E-Mail-Adresse {aussendienst.email} ist bereits vergeben"
