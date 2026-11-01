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


def test_neuer_raumtyp_ohne_auswirkung_still_uebernommen(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    """Verfeinerte Sperre (18.10.2026): Ein neuer Raumtyp, der im Projekt nicht vorkommt, sperrt nicht."""
    _raum(client, projekt)
    pid = projekt["projekt"]["id"]
    anmelden(client, fachpruefer.email)
    client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"})
    typ = client.post("/api/fachvorgaben/raumtypen", json={"bezeichnung": "TESTBAD", "theta_int": 24}).json()
    client.put("/api/fachvorgaben/pauschalen", json={"raumtyp_id": typ["id"], "gebaeudestandard": "neubau", "w_m2": 60})
    anmelden(client, aussendienst.email)
    v = _vorgaben(client, projekt)
    assert v["unterschiede"] == [] and v["offen"] is False
    assert [t["bezeichnung"] for t in v["vorgaben"]["raumtypen"]] == ["TESTBAD"]  # sofort auswählbar
    p = client.get(f"/api/projekte/{pid}").json()
    assert (p["status"], p["vorgaben_offen"]) == ("geprueft", False)  # Prüfung bleibt gültig
    eintraege = [e for e in client.get(f"/api/projekte/{pid}/protokoll").json() if e["aktion"] == "vorgaben_uebernommen"]
    assert eintraege and eintraege[0]["aenderungen"]["automatisch"] is True
    assert eintraege[0]["benutzer_name"] == fachpruefer.name


def test_quellenaenderung_sperrt_nicht(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    _raum(client, projekt)
    _werte_setzen(client, fachpruefer, quelle="TESTQUELLE NEU")
    assert client.get(f"/api/projekte/{projekt['projekt']['id']}").json()["vorgaben_offen"] is False


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
    _raum(client, projekt)
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


# ── Verfeinerte Sperre: Sammelansicht, Vorschau, Ablehnung (Festlegung 18.10.2026) ──


def _zwei_projekte(client, aussendienst):
    """P-A mit Raum ohne Raumtyp (Rückfallwert), P-B ohne Räume."""
    anmelden(client, aussendienst.email)
    ids = []
    for nummer in ("P-A", "P-B"):
        p = client.post("/api/projekte", json={"nummer": nummer, "bezeichnung": nummer, "gebaeudestandard": "neubau"}).json()
        if nummer == "P-A":
            g = client.post(f"/api/objekte/{p['objekte'][0]['id']}/geschosse", json={"bezeichnung": "EG"}).json()
            client.post(f"/api/geschosse/{g['id']}/raeume", json={"bezeichnung": "Raum", "laenge_m": 4, "breite_m": 5})
        ids.append(p["id"])
    return ids


def test_vorschau_zeigt_betroffene_ohne_zu_speichern(client, aussendienst, fachpruefer):
    pa, _pb = _zwei_projekte(client, aussendienst)
    anmelden(client, fachpruefer.email)
    werte = client.get("/api/fachvorgaben").json()["werte"]
    werte.pop("geaendert_am")
    v = client.post("/api/fachvorgaben/vorschau", json={"art": "werte", "daten": werte | {"rueckfall_neubau_w_m2": 50}}).json()
    assert v["geprueft"] == 2
    assert [(b["bezeichnung"], b["summe_alt_w"], b["summe_neu_w"]) for b in v["betroffen"]] == [("P-A", 900, 1000)]
    assert client.get("/api/fachvorgaben").json()["werte"]["rueckfall_neubau_w_m2"] == 45  # nichts gespeichert
    # reine Quellenänderung betrifft niemanden
    v = client.post("/api/fachvorgaben/vorschau", json={"art": "werte", "daten": werte | {"quelle": "NEU"}}).json()
    assert v["betroffen"] == []
    # Außendienst darf nicht
    anmelden(client, aussendienst.email)
    assert client.post("/api/fachvorgaben/vorschau", json={"art": "werte", "daten": werte}).status_code == 403


def test_sammelansicht_und_sammelentscheidung(client, aussendienst, fachpruefer):
    pa, pb = _zwei_projekte(client, aussendienst)
    _werte_setzen(client, fachpruefer, rueckfall_neubau_w_m2=50)
    # nur P-A ist betroffen, P-B hat still übernommen
    liste = client.get("/api/fachvorgaben/abgleich").json()
    assert [(x["bezeichnung"], x["summe_alt_w"], x["summe_neu_w"], x["neue_verstoesse"]) for x in liste] == [("P-A", 900, 1000, 0)]
    assert liste[0]["raeume"][0]["bezeichnung"] == "EG · Raum" and liste[0]["unterschiede"] == 1
    assert client.get(f"/api/projekte/{pb}").json()["vorgaben_offen"] is False

    ergebnis = client.post("/api/fachvorgaben/abgleich", json={"aktion": "ablehnen", "projekt_ids": [pa, 99999], "bemerkung": "TEST"}).json()
    assert ergebnis[0] == {"projekt_id": pa, "ok": True, "meldung": ""}
    assert ergebnis[1]["ok"] is False and "nicht gefunden" in ergebnis[1]["meldung"]
    assert client.get("/api/fachvorgaben/abgleich").json() == []
    eintrag = next(e for e in client.get(f"/api/projekte/{pa}/protokoll").json() if e["aktion"] == "vorgaben_abgelehnt")
    assert eintrag["aenderungen"]["bemerkung"] == "TEST"

    # neue zentrale Änderung ohne Auswirkung auf P-A: Ablehnung gilt weiter, keine Sperre
    anmelden(client, fachpruefer.email)
    client.post("/api/fachvorgaben/raumtypen", json={"bezeichnung": "TESTNEU"})
    assert client.get(f"/api/projekte/{pa}").json()["vorgaben_offen"] is False
    # Änderung mit Auswirkung: wieder offen, Übernahme per Sammelaktion
    _werte_setzen(client, fachpruefer, rueckfall_neubau_w_m2=55)
    assert client.get(f"/api/projekte/{pa}").json()["vorgaben_offen"] is True
    ergebnis = client.post("/api/fachvorgaben/abgleich", json={"aktion": "uebernehmen", "projekt_ids": [pa]}).json()
    assert ergebnis == [{"projekt_id": pa, "ok": True, "meldung": ""}]
    assert _auswertung(client, {"objekt": client.get(f"/api/projekte/{pa}").json()["objekte"][0]})["summe"]["phi_massgeblich_w"] == pytest.approx(1100)

    anmelden(client, aussendienst.email)
    assert client.get("/api/fachvorgaben/abgleich").status_code == 403
    assert client.post("/api/fachvorgaben/abgleich", json={"aktion": "uebernehmen", "projekt_ids": [pa]}).status_code == 403


def test_sammelentscheidung_meldet_gesperrte_projekte(client, aussendienst, fachpruefer):
    pa, _pb = _zwei_projekte(client, aussendienst)
    client.post(f"/api/projekte/{pa}/auschecken", json={"geraet": "Tablet 1"})
    _werte_setzen(client, fachpruefer, rueckfall_neubau_w_m2=50)
    ergebnis = client.post("/api/fachvorgaben/abgleich", json={"aktion": "uebernehmen", "projekt_ids": [pa]}).json()
    assert ergebnis[0]["ok"] is False and "ausgecheckt" in ergebnis[0]["meldung"]


def test_cli_regel_setzen_und_uebernehmen(db, client, aussendienst):
    from app.cli import regel_setzen, vorgaben_uebernehmen_cli

    pa, pb = _zwei_projekte(client, aussendienst)
    text = regel_setzen(db, "mindesthoehe_m", 2, None, "TESTQUELLE")
    assert "Mindestraumhöhe für Deckenmontage: 2 m" in text and "2 ohne Auswirkung übernommen" in text
    with pytest.raises(ValueError):
        regel_setzen(db, "gibtsnicht", 1, None, "Q")
    with pytest.raises(ValueError):
        regel_setzen(db, "mindesthoehe_m", 2, None, " ")
    from app.models import Projekt

    assert "Status entwurf" in vorgaben_uebernehmen_cli(db, db.get(Projekt, pa).nummer)
