"""Eingefrorene Fachvorgaben je Projekt und kombinierbare Rollen (Festlegungen 12.10.2026).

Alle Zahlen sind TESTWERTE. Testdatenbank: Rückfall Neubau 45 W/m², Raum 4 × 5 m = 20 m².
"""
import pytest

from tests.conftest import _benutzer, anmelden
from tests.test_projekt import _auswertung, _raum, projekt  # noqa: F401  (Fixture)


def _werte_setzen(client, fachpruefer, **neu):
    anmelden(client, fachpruefer.email)
    werte = client.get("/api/fachvorgaben").json()["werte"]
    werte.pop("geaendert_am", None)
    assert client.put("/api/fachvorgaben/werte", json=werte | neu).status_code == 200


def _vorgaben(client, projekt):  # noqa: F811
    antwort = client.get(f"/api/projekte/{projekt['projekt']['id']}/vorgaben")
    assert antwort.status_code == 200, antwort.text
    return antwort.json()


def test_projekt_rechnet_mit_eingefrorenen_vorgaben(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    _raum(client, projekt)
    v = _vorgaben(client, projekt)
    assert v["stand_am"] and v["unterschiede"] == [] and v["auswirkung"] is None
    assert v["vorgaben"]["werte"]["rueckfall_neubau_w_m2"] == 45
    assert v["vorgaben"]["gebaeudestandards"]["neubau"] == "Neubau"

    # zentrale Änderung wirkt nicht automatisch
    _werte_setzen(client, fachpruefer, rueckfall_neubau_w_m2=50)
    anmelden(client, aussendienst.email)
    assert _auswertung(client, projekt)["raeume"][0]["phi_massgeblich_w"] == pytest.approx(900)

    # … wird aber mit alt/neu und Auswirkung angezeigt
    v = _vorgaben(client, projekt)
    assert v["unterschiede"] == [
        {"bereich": "Einzelwert", "bezeichnung": "Rückfallwert Neubau (W/m²)", "alt": 45, "neu": 50}
    ]
    assert v["auswirkung"]["summe_alt_w"] == pytest.approx(900)
    assert v["auswirkung"]["summe_neu_w"] == pytest.approx(1000)
    assert v["auswirkung"]["raeume"][0]["bezeichnung"] == "EG · Raum"


def test_uebernahme_per_klick_protokolliert(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    _raum(client, projekt)
    pid = projekt["projekt"]["id"]
    _werte_setzen(client, fachpruefer, rueckfall_neubau_w_m2=50)
    anmelden(client, aussendienst.email)
    vorher = client.get(f"/api/projekte/{pid}").json()["vorgaben_stand_am"]
    # nur der Fachprüfer übernimmt (Festlegung 13.10.2026)
    assert client.post(f"/api/projekte/{pid}/vorgaben/uebernehmen").status_code == 403

    anmelden(client, fachpruefer.email)
    v = client.post(f"/api/projekte/{pid}/vorgaben/uebernehmen").json()
    assert v["unterschiede"] == []
    assert v["vorgaben"]["werte"]["rueckfall_neubau_w_m2"] == 50
    assert v["stand_am"] != vorher
    assert _auswertung(client, projekt)["raeume"][0]["phi_massgeblich_w"] == pytest.approx(1000)

    eintrag = next(e for e in client.get(f"/api/projekte/{pid}/protokoll").json() if e["aktion"] == "vorgaben_uebernommen")
    assert eintrag["benutzer_name"] == fachpruefer.name
    assert eintrag["aenderungen"]["heizlast_summe_w"] == [900, 1000]
    assert eintrag["aenderungen"]["unterschiede"][0]["neu"] == 50


def test_neuer_raumtyp_und_pauschale_als_unterschied(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    anmelden(client, fachpruefer.email)
    typ = client.post("/api/fachvorgaben/raumtypen", json={"bezeichnung": "TESTBAD", "theta_int": 24}).json()
    client.put("/api/fachvorgaben/pauschalen", json={"raumtyp_id": typ["id"], "gebaeudestandard": "neubau", "w_m2": 60})
    anmelden(client, aussendienst.email)
    v = _vorgaben(client, projekt)
    assert {"bereich": "Raumtyp", "bezeichnung": "TESTBAD", "alt": None, "neu": "neu"} in v["unterschiede"]
    assert {"bereich": "Pauschale", "bezeichnung": "TESTBAD / Neubau (W/m²)", "alt": None, "neu": 60} in v["unterschiede"]
    # Raumtypen im Projekt erst nach Übernahme
    assert v["vorgaben"]["raumtypen"] == []
    anmelden(client, fachpruefer.email)
    v = client.post(f"/api/projekte/{projekt['projekt']['id']}/vorgaben/uebernehmen").json()
    assert [t["bezeichnung"] for t in v["vorgaben"]["raumtypen"]] == ["TESTBAD"]


def test_freigegebene_projekte_bleiben_unveraendert(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    _raum(client, projekt)
    pid = projekt["projekt"]["id"]
    anmelden(client, fachpruefer.email)
    client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"})
    client.post(f"/api/projekte/{pid}/status", json={"status": "freigegeben"})
    _werte_setzen(client, fachpruefer, rueckfall_neubau_w_m2=50)
    v = _vorgaben(client, projekt)
    assert v["unterschiede"] == []  # keine Übernahme angeboten
    assert v["vorgaben"]["werte"]["rueckfall_neubau_w_m2"] == 45
    assert client.post(f"/api/projekte/{pid}/vorgaben/uebernehmen").status_code == 409
    assert _auswertung(client, projekt)["summe"]["phi_massgeblich_w"] == pytest.approx(900)


def test_uebernahme_setzt_geprueft_zurueck_und_respektiert_sperre(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    pid = projekt["projekt"]["id"]
    anmelden(client, fachpruefer.email)
    client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"})
    _werte_setzen(client, fachpruefer, rueckfall_neubau_w_m2=50)
    assert client.post(f"/api/projekte/{pid}/vorgaben/uebernehmen").json()["unterschiede"] == []
    assert client.get(f"/api/projekte/{pid}").json()["status"] == "entwurf"

    # ausgecheckt von einem anderen Gerät → 423
    anmelden(client, aussendienst.email)
    client.post(f"/api/projekte/{pid}/auschecken", json={"geraet": "Tablet 1"})
    _werte_setzen(client, fachpruefer, rueckfall_neubau_w_m2=55)
    assert client.post(f"/api/projekte/{pid}/vorgaben/uebernehmen").status_code == 423


# ── Neue Vorgaben: nur Fachprüfer entscheidet, bis dahin kein Angebot (Festlegung 13.10.2026) ──


def _projekt(client, projekt):  # noqa: F811
    return client.get(f"/api/projekte/{projekt['projekt']['id']}").json()


def test_neue_vorgaben_sperren_angebot_bis_entscheidung(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    _raum(client, projekt)
    pid = projekt["projekt"]["id"]
    p = _projekt(client, projekt)
    assert (p["vorgaben_offen"], p["angebot_gesperrt"]) == (False, False)

    _werte_setzen(client, fachpruefer, rueckfall_neubau_w_m2=50)
    p = _projekt(client, projekt)
    assert (p["vorgaben_offen"], p["angebot_gesperrt"], p["wartet_auf_fachpruefer"]) == (True, True, False)
    assert [x["vorgaben_offen"] for x in client.get("/api/projekte").json()] == [True]
    assert _vorgaben(client, projekt)["offen"] is True

    # Prüfen erst nach der Entscheidung
    antwort = client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"})
    assert antwort.status_code == 409
    assert "übernehmen oder bewusst ablehnen" in antwort.json()["detail"]

    # Außendienst darf weder übernehmen noch ablehnen
    anmelden(client, aussendienst.email)
    assert client.post(f"/api/projekte/{pid}/vorgaben/ablehnen", json={}).status_code == 403
    assert client.post(f"/api/projekte/{pid}/vorgaben/uebernehmen").status_code == 403

    # Fachprüfer lehnt bewusst ab: Projekt rechnet weiter mit 45 W/m², Sperre entfällt, protokolliert
    anmelden(client, fachpruefer.email)
    v = client.post(f"/api/projekte/{pid}/vorgaben/ablehnen", json={"bemerkung": "TESTBEGRÜNDUNG"}).json()
    assert v["offen"] is False and v["abgelehnt_am"]
    assert v["unterschiede"][0]["neu"] == 50  # weiter sichtbar, damit der Fachprüfer später doch übernehmen kann
    assert _auswertung(client, projekt)["summe"]["phi_massgeblich_w"] == pytest.approx(900)
    p = _projekt(client, projekt)
    assert (p["vorgaben_offen"], p["angebot_gesperrt"]) == (False, False)
    eintrag = next(e for e in client.get(f"/api/projekte/{pid}/protokoll").json() if e["aktion"] == "vorgaben_abgelehnt")
    assert eintrag["benutzer_name"] == fachpruefer.name
    assert eintrag["aenderungen"]["bemerkung"] == "TESTBEGRÜNDUNG"
    assert eintrag["aenderungen"]["unterschiede"][0]["neu"] == 50
    assert client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"}).status_code == 200
    assert _projekt(client, projekt)["status"] == "geprueft"  # Ablehnen ändert keine Projektdaten

    # zentral erneut geändert: wieder offen
    _werte_setzen(client, fachpruefer, rueckfall_neubau_w_m2=55)
    assert _projekt(client, projekt)["vorgaben_offen"] is True
    # nur die Quelle geändert: zählt nicht als neue Vorgabe
    client.post(f"/api/projekte/{pid}/vorgaben/ablehnen")
    _werte_setzen(client, fachpruefer, quelle="TESTQUELLE NEU")
    assert _projekt(client, projekt)["vorgaben_offen"] is False

    # später doch übernommen: Ablehnung erledigt
    v = client.post(f"/api/projekte/{pid}/vorgaben/uebernehmen").json()
    assert v["unterschiede"] == [] and v["abgelehnt_am"] is None
    assert _projekt(client, projekt)["vorgaben_offen"] is False


def test_freigegeben_hat_keine_offenen_vorgaben(client, projekt, fachpruefer):  # noqa: F811
    pid = projekt["projekt"]["id"]
    anmelden(client, fachpruefer.email)
    client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"})
    client.post(f"/api/projekte/{pid}/status", json={"status": "freigegeben"})
    _werte_setzen(client, fachpruefer, rueckfall_neubau_w_m2=50)
    p = _projekt(client, projekt)
    assert (p["vorgaben_offen"], p["angebot_gesperrt"]) == (False, False)
    assert client.post(f"/api/projekte/{pid}/vorgaben/ablehnen").status_code == 409


def test_offline_paket_enthaelt_vorgabenstand(client, projekt):  # noqa: F811
    paket = client.get(f"/api/offline/projekte/{projekt['projekt']['id']}").json()
    assert paket["vorgaben_stand"]["werte"]["rueckfall_neubau_w_m2"] == 45


def test_admin_und_fachpruefer_kombiniert(client, db, projekt):  # noqa: F811
    beides = _benutzer(db, "beides@test.invalid", "admin")
    beides.rollen = ["admin", "fachpruefer"]
    db.commit()
    nur_admin = _benutzer(db, "nuradmin@test.invalid", "admin")
    pid = projekt["projekt"]["id"]

    anmelden(client, nur_admin.email)
    assert client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"}).status_code == 403

    anmelden(client, beides.email)
    assert client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"}).status_code == 200
    assert client.post(f"/api/projekte/{pid}/status", json={"status": "freigegeben"}).status_code == 200
    # und darf weiter Benutzer verwalten
    assert client.get("/api/benutzer").status_code == 200
