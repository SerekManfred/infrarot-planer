"""Objektbibliothek (Festlegung 01.11.2026): Pflege, Rechte, Einfrieren je Projekt, Regelprüfung, Umstellung.

Alle Zahlen sind TESTWERTE bzw. die Startausstattung (conftest, Quelle TESTWERT).
"""
import importlib.util
from pathlib import Path

import pytest

from tests.conftest import anmelden
from tests.test_projekt import _auswertung, _patch, _post, _raum, _uebernehmen, projekt  # noqa: F401  (Fixture)

MODUL = {"id": "m1", "modul_id": None, "artikel_nr": "T-1", "bezeichnung": "TESTMODUL", "leistung_w": 500,
         "laenge_m": 1.0, "breite_m": 0.6, "schutzart": "IP44", "bad_geeignet": True, "x": 1.5, "y": 2.0, "gedreht": False}


def _objekte(client):
    return {o["schluessel"]: o for o in client.get("/api/fachvorgaben").json()["objekte"]}


def test_startausstattung_in_den_fachvorgaben(client, aussendienst):
    anmelden(client, aussendienst.email)
    o = _objekte(client)
    assert len(o) == 30
    assert (o["sofa"]["breite_m"], o["sofa"]["tiefe_m"], o["sofa"]["hoehe_m"], o["sofa"]["kategorie"], o["sofa"]["abstand_cm"]) == (
        2.2, 0.9, 0.45, "tabu", 30)
    assert (o["couchtisch"]["kategorie"], o["couchtisch"]["abstand_cm"]) == ("neutral", None)
    assert (o["leuchte"]["form"], o["leuchte"]["gruppe"], o["leuchte"]["abstand_cm"]) == ("punkt", "decke", 50)
    assert (o["dachschraege"]["form"], o["dachschraege"]["breite_m"], o["dachschraege"]["kategorie"]) == ("streifen", 1.0, "abstand")
    assert o["kleiderschrank"]["kategorie"] == "abstand" and o["dusche"]["hoehe_m"] == 0


def test_pflege_nur_fachpruefer_und_admin(client, aussendienst, fachpruefer):
    neu = {"name": "TEST Klavier", "gruppe": "moebel", "form": "rechteck", "breite_m": 1.5, "tiefe_m": 0.6,
           "hoehe_m": 1.2, "kategorie": "abstand", "abstand_cm": 20, "quelle": "TESTWERT"}
    anmelden(client, aussendienst.email)
    assert client.post("/api/fachvorgaben/objekte", json=neu).status_code == 403
    anmelden(client, fachpruefer.email)
    o = _post(client, "/api/fachvorgaben/objekte", neu)
    assert o["schluessel"] == "test_klavier" and o["aktiv"] is True
    assert client.post("/api/fachvorgaben/objekte", json=neu).status_code == 409
    assert client.post("/api/fachvorgaben/objekte", json={**neu, "name": "X", "tiefe_m": None}).status_code == 422
    assert client.post("/api/fachvorgaben/objekte", json={**neu, "name": "Y", "quelle": " "}).status_code == 422
    assert client.post("/api/fachvorgaben/objekte", json={**neu, "name": "Z", "raumtyp_ids": [999]}).status_code == 422
    geaendert = _patch(client, f"/api/fachvorgaben/objekte/{o['id']}", {"abstand_cm": None, "aktiv": False})
    assert geaendert["abstand_cm"] is None and geaendert["aktiv"] is False and geaendert["schluessel"] == "test_klavier"
    # Punkt: Maße werden geleert
    p = _post(client, "/api/fachvorgaben/objekte", {**neu, "name": "TEST Sensor", "form": "punkt", "gruppe": "decke"})
    assert (p["breite_m"], p["tiefe_m"], p["hoehe_m"]) == (None, None, None)
    eintraege = client.get("/api/fachvorgaben/protokoll").json()
    assert any(e["objektart"] == "BibObjekt" for e in eintraege)


def _projekt_mit_couchtisch(client, projekt, fachpruefer):
    """Raum 4 × 5 m mit Couchtisch (neutral) und einem Modul genau darüber."""
    anmelden(client, fachpruefer.email)
    for schluessel, wert in (("abstand_wand_cm", 50), ("abstand_modul_cm", 40), ("leistungsreserve_prozent", 10)):
        client.patch(f"/api/fachvorgaben/regeln/{schluessel}", json={"wert": wert, "quelle": "TESTWERT"})
    _uebernehmen(client, projekt, fachpruefer)
    raum = _raum(client, projekt)
    tisch = {"id": "s1", "objekt": "couchtisch", "x": 1.0, "y": 1.5, "b": 2.0, "t": 2.0}
    _patch(client, f"/api/raeume/{raum['id']}", {"sperrflaechen": [tisch], "module": [MODUL]})
    return raum


def test_kategorie_aus_der_bibliothek_und_einfrieren(client, projekt, fachpruefer):  # noqa: F811
    _projekt_mit_couchtisch(client, projekt, fachpruefer)
    assert _auswertung(client, projekt)["raeume"][0]["modulplanung"]["verstoesse"]["m1"] == []
    tisch = _objekte(client)["couchtisch"]
    pid = projekt["projekt"]["id"]

    # Vorschau vor dem Speichern: das Projekt wäre betroffen (neuer Verstoß)
    v = client.post("/api/fachvorgaben/vorschau", json={"art": "objekt_aendern", "ziel": tisch["id"],
                                                        "daten": {"kategorie": "tabu", "abstand_cm": 30}}).json()
    assert [p["projekt_id"] for p in v["betroffen"]] == [pid] and v["betroffen"][0]["neue_verstoesse"] == 1

    _patch(client, f"/api/fachvorgaben/objekte/{tisch['id']}", {"kategorie": "tabu", "abstand_cm": 30})
    # Projekt rechnet weiter mit seinem eingefrorenen Stand und wartet auf den Fachprüfer
    assert client.get(f"/api/projekte/{pid}").json()["vorgaben_offen"] is True
    assert _auswertung(client, projekt)["raeume"][0]["modulplanung"]["verstoesse"]["m1"] == []
    unterschiede = client.get(f"/api/projekte/{pid}/vorgaben").json()["unterschiede"]
    assert {"bereich": "Objektbibliothek", "bezeichnung": "Couchtisch: Kategorie", "alt": "neutral", "neu": "tabu"} in unterschiede
    _uebernehmen(client, projekt, fachpruefer)
    assert _auswertung(client, projekt)["raeume"][0]["modulplanung"]["verstoesse"]["m1"] == [
        "liegt über Couchtisch – dort ist kein Modul zulässig"
    ]


def test_aenderung_ohne_auswirkung_still_uebernommen(client, projekt, fachpruefer):  # noqa: F811
    _projekt_mit_couchtisch(client, projekt, fachpruefer)
    sofa = _objekte(client)["sofa"]  # kommt im Projekt nicht vor
    _patch(client, f"/api/fachvorgaben/objekte/{sofa['id']}", {"abstand_cm": 40, "breite_m": 2.4})
    p = client.get(f"/api/projekte/{projekt['projekt']['id']}/vorgaben").json()
    assert p["unterschiede"] == []
    assert {o["schluessel"]: o for o in p["vorgaben"]["objekte"]}["sofa"]["abstand_cm"] == 40


def test_waermeverteilung_hoehe_gespeichert(client, projekt, aussendienst):  # noqa: F811
    anmelden(client, aussendienst.email)
    raum = _raum(client, projekt)
    sofa = {"id": "s1", "objekt": "sofa", "x": 1, "y": 1, "b": 2.2, "t": 0.9, "hoehe": 0.4}
    r = _patch(client, f"/api/raeume/{raum['id']}", {"sperrflaechen": [sofa]})
    assert {k: r["sperrflaechen"][0][k] for k in sofa} == sofa


def _migration():
    pfad = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261101_b7d1e5a3c2f8_objektbibliothek.py"
    if not pfad.exists():
        pytest.skip("Migrationen nicht im Testabbild")
    spec = importlib.util.spec_from_file_location("migration_objektbibliothek", pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def test_umstellung_eingefrorener_staende():
    m = _migration()
    stand = {"werte": {}, "raumtypen": [], "pauschalen": [], "regeln": [
        {"schluessel": "abstand_wand_cm", "wert": 50, "quelle": "Q1"},
        {"schluessel": "abstand_sitzplatz_cm", "wert": 25, "quelle": "TESTQUELLE Abstand"},
        {"schluessel": "hoehe_sitzplatz_m", "wert": 0.4, "quelle": "TESTQUELLE Höhe"},
        {"schluessel": "bett_sperrflaeche", "wert": None, "wert_text": "ja", "quelle": "Q"},
    ]}
    neu = m._stand_umstellen(stand, {"Wohnen": 1, "Bad": 3})
    assert [r["schluessel"] for r in neu["regeln"]] == ["abstand_wand_cm"]
    o = {x["schluessel"]: x for x in neu["objekte"]}
    # Werte des jeweiligen Projektstands bleiben erhalten, Quelle nachvollziehbar
    assert (o["sitzplatz"]["abstand_cm"], o["sitzplatz"]["hoehe_m"]) == (25, 0.4)
    assert o["sitzplatz"]["quelle"].startswith("Abstand: TESTQUELLE Abstand; Höhe: TESTQUELLE Höhe; Maße, Kategorie: ")
    assert o["dusche"]["raumtyp_ids"] == [3] and o["sitzplatz"]["raumtyp_ids"] == [1]
    assert o["badewanne"]["quelle"] == "Vorgabe – von Serek prüfen, Stand 01.11.2026"
    assert m._stand_umstellen(neu, {}) is neu  # schon umgestellt: unverändert
