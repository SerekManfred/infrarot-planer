"""Modulkatalog pflegen und Moduldaten in laufenden Projekten (Festlegung 31.10.2026). Alle Werte sind TESTWERTE."""
import io

import pytest
from openpyxl import load_workbook

from app.excel_import import KOPF_MODULE
from tests.conftest import anmelden
from tests.test_projekt import _auswertung, _patch, _post, _raum, projekt  # noqa: F401  (Fixture)

MODUL = {
    "artikel_nr": "T-900", "bezeichnung": "TESTMODUL 900", "leistung_w": 900, "laenge_mm": 1000, "breite_mm": 800,
    "schutzart": "IP44", "bad_geeignet": True, "quelle": "TESTWERT",
}


def _modul_anlegen(client, fachpruefer, **teil):
    anmelden(client, fachpruefer.email)
    return _post(client, "/api/bibliotheken/module", MODUL | teil)


def _platzieren(client, projekt, modul, **lage):  # noqa: F811
    """Raum 4 × 5 m mit einem Modul (Kopie der Katalogdaten wie beim Platzieren im Deckenplan)."""
    raum = _raum(client, projekt)
    kopie = {
        "id": "m1", "modul_id": modul["id"], "artikel_nr": modul["artikel_nr"], "bezeichnung": modul["bezeichnung"],
        "leistung_w": modul["leistung_w"], "laenge_m": max(modul["laenge_mm"], modul["breite_mm"]) / 1000,
        "breite_m": min(modul["laenge_mm"], modul["breite_mm"]) / 1000, "schutzart": modul["schutzart"],
        "bad_geeignet": modul["bad_geeignet"], "x": 1.5, "y": 2.0, "gedreht": False, **lage,
    }
    return _patch(client, f"/api/raeume/{raum['id']}", {"module": [kopie]})


# ── Pflege ──


def test_rechte_und_plausibilitaet(client, aussendienst, fachpruefer, admin):
    anmelden(client, aussendienst.email)
    assert client.get("/api/bibliotheken/module").status_code == 200  # lesen dürfen alle
    assert client.post("/api/bibliotheken/module", json=MODUL).status_code == 403
    m = _modul_anlegen(client, fachpruefer)
    anmelden(client, aussendienst.email)
    assert client.patch(f"/api/bibliotheken/module/{m['id']}", json={"leistung_w": 1}).status_code == 403
    assert client.delete(f"/api/bibliotheken/module/{m['id']}").status_code == 403

    anmelden(client, admin.email)  # Admin darf ebenfalls pflegen
    for falsch, text in (
        ({"leistung_w": 0}, "Leistung muss größer als 0 sein"),
        ({"laenge_mm": -5}, "muss größer als 0 sein"),
        ({"schutzart": "44"}, "ist ungültig"),
        ({"schutzart": "IP20"}, "„Bad geeignet“ nur ab Schutzart IP44 (hier IP20)"),
        ({"quelle": ""}, "Quelle darf nicht leer sein"),
    ):
        antwort = client.patch(f"/api/bibliotheken/module/{m['id']}", json=falsch)
        assert antwort.status_code == 422, falsch
        assert text in antwort.json()["detail"], antwort.json()["detail"]
    antwort = client.post("/api/bibliotheken/module", json=MODUL)
    assert antwort.status_code == 409 and antwort.json()["detail"] == "Artikel-Nr. T-900 ist bereits vergeben"
    # IP20 geht, wenn nicht badgeeignet
    assert _patch(client, f"/api/bibliotheken/module/{m['id']}", {"schutzart": "IP20", "bad_geeignet": False})["schutzart"] == "IP20"


def test_jede_aenderung_protokolliert(client, fachpruefer):
    m = _modul_anlegen(client, fachpruefer)
    _patch(client, f"/api/bibliotheken/module/{m['id']}", {"vk_netto": 499.0, "montagezeit_min": 45})
    eintrag = client.get("/api/fachvorgaben/protokoll").json()[0]
    assert eintrag["objektart"] == "BibModul" and eintrag["benutzer_name"] == fachpruefer.name
    assert eintrag["aenderungen"]["vk_netto"] == [None, 499.0]
    assert eintrag["aenderungen"]["montagezeit_min"] == [None, 45.0]


def test_loeschen_nur_unbenutzt_sonst_deaktivieren(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    benutzt = _modul_anlegen(client, fachpruefer)
    frei = _modul_anlegen(client, fachpruefer, artikel_nr="T-FREI")
    anmelden(client, aussendienst.email)
    _platzieren(client, projekt, benutzt)
    anmelden(client, fachpruefer.email)
    assert client.delete(f"/api/bibliotheken/module/{frei['id']}").status_code == 204
    antwort = client.delete(f"/api/bibliotheken/module/{benutzt['id']}")
    assert antwort.status_code == 409 and "in 1 Projekt verwendet" in antwort.json()["detail"]
    # deaktivieren: nicht mehr auswählbar (Offline-Katalog), Planung bleibt gültig und unverändert
    assert _patch(client, f"/api/bibliotheken/module/{benutzt['id']}", {"aktiv": False})["aktiv"] is False
    assert client.get("/api/offline/vorgaben").json()["module"] == []
    anmelden(client, aussendienst.email)
    assert _auswertung(client, projekt)["raeume"][0]["modulplanung"]["installiert_w"] == 900
    assert client.get(f"/api/projekte/{projekt['projekt']['id']}").json()["module_offen"] is False


def test_export_excel_wie_importdatei(client, aussendienst, fachpruefer):
    _modul_anlegen(client, fachpruefer, ek_netto=300.5)
    anmelden(client, aussendienst.email)
    antwort = client.get("/api/bibliotheken/module/export.xlsx")
    assert antwort.status_code == 200 and "Modulkatalog_" in antwort.headers["content-disposition"]
    blatt = load_workbook(io.BytesIO(antwort.content))["Modulkatalog"]
    zeilen = list(blatt.iter_rows(values_only=True))
    assert zeilen[0][: len(KOPF_MODULE)] == KOPF_MODULE and zeilen[0][-1] == "aktiv"
    assert zeilen[1][:3] == ("T-900", "TESTMODUL 900", 900) and zeilen[1][8] == "ja" and zeilen[1][10] == 300.5


# ── Moduldaten in laufenden Projekten ──


def test_geaenderte_leistung_wartet_auf_fachpruefer(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    m = _modul_anlegen(client, fachpruefer)
    anmelden(client, aussendienst.email)
    _platzieren(client, projekt, m)
    pid = projekt["projekt"]["id"]
    assert client.get(f"/api/projekte/{pid}").json()["module_offen"] is False

    anmelden(client, fachpruefer.email)
    _patch(client, f"/api/bibliotheken/module/{m['id']}", {"leistung_w": 1000})
    p = client.get(f"/api/projekte/{pid}").json()
    assert (p["module_offen"], p["angebot_gesperrt"]) == (True, True)
    a = client.get(f"/api/projekte/{pid}/module-abgleich").json()
    assert a["offen"] is True
    assert a["unterschiede"] == [{"modul_id": m["id"], "artikel_nr": "T-900", "feld": "leistung_w",
                                  "bezeichnung": "T-900: Leistung (W)", "alt": 900.0, "neu": 1000.0}]
    assert (a["auswirkung"]["installiert_alt_w"], a["auswirkung"]["installiert_neu_w"]) == (900, 1000)
    # Projekt rechnet bis zur Entscheidung mit seinem Stand; Prüfen gesperrt
    assert _auswertung(client, projekt)["raeume"][0]["modulplanung"]["installiert_w"] == 900
    antwort = client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"})
    assert antwort.status_code == 409 and "Module" in antwort.json()["detail"]
    # Außendienst darf nicht entscheiden
    anmelden(client, aussendienst.email)
    assert client.post(f"/api/projekte/{pid}/module/uebernehmen").status_code == 403

    # ablehnen: bleibt bei 900 W, nicht mehr offen; erneute Änderung → wieder offen
    anmelden(client, fachpruefer.email)
    assert client.post(f"/api/projekte/{pid}/module/ablehnen", json={"bemerkung": "TEST"}).json()["offen"] is False
    assert client.get(f"/api/projekte/{pid}").json()["module_offen"] is False
    _patch(client, f"/api/bibliotheken/module/{m['id']}", {"leistung_w": 1100})
    assert client.get(f"/api/projekte/{pid}").json()["module_offen"] is True

    # übernehmen: Raum rechnet mit 1 100 W, Lage bleibt, protokolliert
    a = client.post(f"/api/projekte/{pid}/module/uebernehmen").json()
    assert a["offen"] is False and a["unterschiede"] == []
    r = _auswertung(client, projekt)["raeume"][0]
    assert r["modulplanung"]["installiert_w"] == 1100
    raum = client.get(f"/api/raeume/{r['raum_id']}").json()
    assert (raum["module"][0]["x"], raum["module"][0]["leistung_w"]) == (1.5, 1100)
    aktionen = [e["aktion"] for e in client.get(f"/api/projekte/{pid}/protokoll").json()]
    assert "module_uebernommen" in aktionen and "module_abgelehnt" in aktionen


def test_textaenderung_still_uebernommen(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    m = _modul_anlegen(client, fachpruefer)
    anmelden(client, aussendienst.email)
    _platzieren(client, projekt, m)
    pid = projekt["projekt"]["id"]
    anmelden(client, fachpruefer.email)
    client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"})
    _patch(client, f"/api/bibliotheken/module/{m['id']}", {"bezeichnung": "TESTMODUL 900 neu", "vk_netto": 100})
    p = client.get(f"/api/projekte/{pid}").json()
    assert (p["module_offen"], p["status"]) == (False, "geprueft")
    raum_id = _auswertung(client, projekt)["raeume"][0]["raum_id"]
    assert client.get(f"/api/raeume/{raum_id}").json()["module"][0]["bezeichnung"] == "TESTMODUL 900 neu"
    eintrag = next(e for e in client.get(f"/api/projekte/{pid}/protokoll").json() if e["aktion"] == "module_uebernommen")
    assert eintrag["aenderungen"]["automatisch"] is True


def test_masse_mit_neuem_regelverstoss_und_sammelansicht(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    anmelden(client, fachpruefer.email)
    client.patch("/api/fachvorgaben/regeln/abstand_wand_cm", json={"wert": 50, "quelle": "TESTWERT"})
    m = _modul_anlegen(client, fachpruefer)
    anmelden(client, aussendienst.email)
    # Projekt rechnet noch ohne Regeln – erst Vorgaben übernehmen, dann Modul 0,5 m vor der rechten Wand platzieren
    anmelden(client, fachpruefer.email)
    client.post(f"/api/projekte/{projekt['projekt']['id']}/vorgaben/uebernehmen")
    anmelden(client, aussendienst.email)
    _platzieren(client, projekt, m, x=2.5)  # 2,5 + 1,0 = 3,5 → 0,5 m zur Wand bei 4 m
    pid = projekt["projekt"]["id"]
    anmelden(client, fachpruefer.email)
    _patch(client, f"/api/bibliotheken/module/{m['id']}", {"laenge_mm": 1200})  # jetzt nur 0,3 m zur Wand
    liste = client.get("/api/fachvorgaben/abgleich").json()
    eintrag = next(x for x in liste if x["art"] == "module")
    assert (eintrag["projekt_id"], eintrag["neue_verstoesse"], eintrag["unterschiede"]) == (pid, 1, 1)
    ergebnis = client.post("/api/fachvorgaben/abgleich", json={"aktion": "uebernehmen", "art": "module", "projekt_ids": [pid]}).json()
    assert ergebnis == [{"projekt_id": pid, "ok": True, "meldung": ""}]
    verstoesse = _auswertung(client, projekt)["raeume"][0]["modulplanung"]["verstoesse"]["m1"]
    assert verstoesse == ["Abstand zur Wand 30 cm (mind. 50 cm)"]


def test_freigegebene_projekte_bleiben_unveraendert(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    m = _modul_anlegen(client, fachpruefer)
    anmelden(client, aussendienst.email)
    _platzieren(client, projekt, m)
    pid = projekt["projekt"]["id"]
    anmelden(client, fachpruefer.email)
    client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"})
    client.post(f"/api/projekte/{pid}/status", json={"status": "freigegeben"})
    _patch(client, f"/api/bibliotheken/module/{m['id']}", {"leistung_w": 1500})
    p = client.get(f"/api/projekte/{pid}").json()
    assert (p["module_offen"], p["status"]) == (False, "freigegeben")
    assert _auswertung(client, projekt)["raeume"][0]["modulplanung"]["installiert_w"] == 900
    assert client.get(f"/api/projekte/{pid}/module-abgleich").json() == {"unterschiede": [], "offen": False, "auswirkung": None}


# ── Wärmeverteilung: Strahlerkennwerte, Höhen, Vorgabewerte (01.11.2026) ──


def test_strahlerkennwerte_im_katalog(client, fachpruefer):
    m = _modul_anlegen(client, fachpruefer)
    assert (m["oberflaechentemperatur_c"], m["emissionsgrad"], m["abstrahlwinkel_grad"]) == (None, None, None)
    m = _patch(client, f"/api/bibliotheken/module/{m['id']}", {"oberflaechentemperatur_c": 95, "emissionsgrad": 0.93, "abstrahlwinkel_grad": 120})
    assert (m["oberflaechentemperatur_c"], m["emissionsgrad"], m["abstrahlwinkel_grad"]) == (95, 0.93, 120)
    for falsch in ({"emissionsgrad": 1.2}, {"emissionsgrad": 0}, {"abstrahlwinkel_grad": 200}, {"oberflaechentemperatur_c": 500}):
        assert client.patch(f"/api/bibliotheken/module/{m['id']}", json=falsch).status_code == 422, falsch
    # leeren erlaubt (dann gilt der Vorgabewert)
    assert _patch(client, f"/api/bibliotheken/module/{m['id']}", {"emissionsgrad": None})["emissionsgrad"] is None
    blatt = load_workbook(io.BytesIO(client.get("/api/bibliotheken/module/export.xlsx").content))["Modulkatalog"]
    kopf = next(blatt.iter_rows(values_only=True))
    assert kopf[15:18] == ("Oberflächentemperatur (°C)", "Emissionsgrad", "Abstrahlwinkel (°)")


def test_vorgabewerte_und_hoehen_in_regeln(client, fachpruefer, aussendienst, projekt):  # noqa: F811
    anmelden(client, fachpruefer.email)
    regeln = {r["schluessel"]: r for r in client.get("/api/fachvorgaben").json()["regeln"]}
    assert {"hoehe_sitzplatz_m", "strahler_temperatur_c", "strahler_emissionsgrad", "strahler_abstrahlwinkel_grad"} <= set(regeln)
    antwort = client.patch("/api/fachvorgaben/regeln/strahler_emissionsgrad", json={"wert": 1.5})
    assert antwort.status_code == 422 and "höchstens 1" in antwort.json()["detail"]
    assert client.patch("/api/fachvorgaben/regeln/strahler_abstrahlwinkel_grad", json={"wert": 0}).status_code == 422
    assert client.patch("/api/fachvorgaben/regeln/strahler_emissionsgrad", json={"wert": 0.9}).status_code == 200
    # Höhe einer Sperrfläche wird gespeichert; ungültige Höhe abgelehnt
    anmelden(client, aussendienst.email)
    raum = _raum(client, projekt)
    sitz = {"id": "s1", "typ": "sitzplatz", "x": 1, "y": 1, "b": 1.5, "t": 1, "hoehe": 0.42}
    assert _patch(client, f"/api/raeume/{raum['id']}", {"sperrflaechen": [sitz]})["sperrflaechen"][0]["hoehe"] == 0.42
    assert client.patch(f"/api/raeume/{raum['id']}", json={"sperrflaechen": [{**sitz, "hoehe": 9}]}).status_code == 422
    # neue Regeln ändern weder Heizlast noch Module: das Projekt bleibt ohne offene Vorgaben (still übernommen)
    assert client.get(f"/api/projekte/{projekt['projekt']['id']}").json()["vorgaben_offen"] is False


# ── Excel-Reimport (02.11.2026) ──


def _export_bearbeiten(client, aendern) -> bytes:
    mappe = load_workbook(io.BytesIO(client.get("/api/bibliotheken/module/export.xlsx").content))
    aendern(mappe["Modulkatalog"])
    puffer = io.BytesIO()
    mappe.save(puffer)
    return puffer.getvalue()


def _datei(inhalt):
    return {"datei": ("Modulkatalog.xlsx", inhalt, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}


def test_reimport_vorschau_und_uebernahme(client, db, fachpruefer):
    m = _modul_anlegen(client, fachpruefer)

    def bearbeiten(blatt):
        blatt["L2"] = 499  # VK netto
        blatt["C2"] = 950  # Leistung
        blatt.append(["T-NEU", "TESTMODUL NEU", 400, 600, 600, None, None, "IP54", "ja", "", None, None, None, "TESTWERT", "", None, None, None, "ja"])

    inhalt = _export_bearbeiten(client, bearbeiten)
    v = client.post("/api/bibliotheken/module/import/vorschau", files=_datei(inhalt)).json()
    assert (v["neu"], v["geaendert"], v["unveraendert"], v["fehler"]) == (["T-NEU"], ["T-900"], 0, [])
    assert {(a["feldname"], a["alt"], a["neu"]) for a in v["aenderungen"]} == {("Leistung (W)", 900.0, 950.0), ("VK netto (€)", None, 499.0)}
    # Vorschau speichert nichts
    assert client.get("/api/bibliotheken/module").json()[0]["leistung_w"] == 900

    e = client.post("/api/bibliotheken/module/import", files=_datei(inhalt), data={"pruefsumme": v["pruefsumme"]}).json()
    assert (e["neu"], e["geaendert"], e["unveraendert"], e["sicherung"]) == (1, 1, 0, None)  # Testdatenbank: keine Sicherung
    module = {x["artikel_nr"]: x for x in client.get("/api/bibliotheken/module").json()}
    assert (module["T-900"]["leistung_w"], module["T-900"]["vk_netto"], module["T-NEU"]["bad_geeignet"]) == (950, 499, True)
    eintrag = next(x for x in client.get("/api/fachvorgaben/protokoll").json() if x["objektart"] == "BibModul" and "leistung_w" in x["aenderungen"])
    assert eintrag["aenderungen"]["leistung_w"] == [900.0, 950.0] and eintrag["benutzer_name"] == fachpruefer.name
    assert m["id"] == module["T-900"]["id"]  # Zuordnung über die Artikel-Nr.


def test_reimport_fehler_mit_zeilennummer_nichts_uebernommen(client, fachpruefer):
    _modul_anlegen(client, fachpruefer)

    def bearbeiten(blatt):
        blatt["C2"] = None  # Leistung leer
        blatt.append(["T-BAD", "BAD IP20", 400, 600, 600, None, None, "IP20", "ja", "", None, None, None, "TESTWERT", "", None, None, None, "ja"])
        blatt.append(["T-BAD", "doppelt", 400, 600, 600, None, None, "IP44", "nein", "", None, None, None, "TESTWERT", "", None, None, None, "vielleicht"])

    inhalt = _export_bearbeiten(client, bearbeiten)
    v = client.post("/api/bibliotheken/module/import/vorschau", files=_datei(inhalt)).json()
    assert [(f["zeile"], f["text"]) for f in v["fehler"]] == [
        (2, "Leistung (W) ist leer"),
        (3, "„Bad geeignet“ nur ab Schutzart IP44 (hier IP20)"),
        (4, "Artikel-Nr. T-BAD doppelt (auch in Zeile 3)"),
    ]
    antwort = client.post("/api/bibliotheken/module/import", files=_datei(inhalt), data={"pruefsumme": v["pruefsumme"]})
    assert antwort.status_code == 422 and "3 Fehler" in antwort.json()["detail"] and "Zeile 2" in antwort.json()["detail"]
    assert client.get("/api/bibliotheken/module").json()[0]["leistung_w"] == 900


def test_reimport_loescht_nie_deaktiviert_nur_und_prueft_datei(client, fachpruefer, aussendienst):
    _modul_anlegen(client, fachpruefer)
    _modul_anlegen(client, fachpruefer, artikel_nr="T-ZWEI")

    def bearbeiten(blatt):
        blatt.delete_rows(3)  # T-ZWEI fehlt in der Datei
        blatt["S2"] = "nein"  # T-900 deaktivieren

    inhalt = _export_bearbeiten(client, bearbeiten)
    v = client.post("/api/bibliotheken/module/import/vorschau", files=_datei(inhalt)).json()
    assert v["aenderungen"] == [{"zeile": 2, "artikel_nr": "T-900", "feld": "aktiv", "feldname": "aktiv", "alt": True, "neu": False}]
    # andere Datei als in der Vorschau → abgelehnt
    antwort = client.post("/api/bibliotheken/module/import", files=_datei(inhalt), data={"pruefsumme": "0" * 64})
    assert antwort.status_code == 422 and "seit der Vorschau verändert" in antwort.json()["detail"]
    client.post("/api/bibliotheken/module/import", files=_datei(inhalt), data={"pruefsumme": v["pruefsumme"]})
    module = {x["artikel_nr"]: x for x in client.get("/api/bibliotheken/module").json()}
    assert set(module) == {"T-900", "T-ZWEI"} and module["T-900"]["aktiv"] is False
    # nur Admin und Fachprüfer
    anmelden(client, aussendienst.email)
    assert client.post("/api/bibliotheken/module/import/vorschau", files=_datei(inhalt)).status_code == 403
    assert client.post("/api/bibliotheken/module/import", files=_datei(inhalt), data={"pruefsumme": v["pruefsumme"]}).status_code == 403
    # keine Excel-Datei
    anmelden(client, fachpruefer.email)
    antwort = client.post("/api/bibliotheken/module/import/vorschau", files=_datei(b"kein excel"))
    assert antwort.status_code == 422 and "nicht als Excel-Datei" in antwort.json()["detail"]


def test_reimport_verwendetes_modul_wartet_im_projekt(client, projekt, aussendienst, fachpruefer):  # noqa: F811
    m = _modul_anlegen(client, fachpruefer)
    anmelden(client, aussendienst.email)
    _platzieren(client, projekt, m)
    anmelden(client, fachpruefer.email)
    inhalt = _export_bearbeiten(client, lambda blatt: blatt.__setitem__("C2", 1200))
    v = client.post("/api/bibliotheken/module/import/vorschau", files=_datei(inhalt)).json()
    e = client.post("/api/bibliotheken/module/import", files=_datei(inhalt), data={"pruefsumme": v["pruefsumme"]}).json()
    assert e["projekte_warten"] == 1
    assert client.get(f"/api/projekte/{projekt['projekt']['id']}").json()["module_offen"] is True
    assert any(x["art"] == "module" for x in client.get("/api/fachvorgaben/abgleich").json())
