"""Excel-Export und -Import aller Tabellen der Fachvorgaben (Paket L, 01.11.2026). Alle Werte sind TESTWERTE."""
import io

import pytest
from openpyxl import load_workbook
from sqlalchemy import select

from app.models import BibKlimadaten, BibObjekt, BibRaumtyp, HeizlastPauschale, Protokoll
from tests.conftest import anmelden
from tests.test_projekt import _auswertung, _patch, _post, _raum, projekt  # noqa: F401  (Fixture)

TABELLEN = {"raumtypen": "Raumtypen", "regeln": "Platzierungsregeln", "objekte": "Objektbibliothek", "bauteile": "U-Werte",
            "klimadaten": "Klimadaten", "module": "Modulkatalog"}


def _export(client, name):
    antwort = client.get(f"/api/tabellen/{name}/export.xlsx")
    assert antwort.status_code == 200, antwort.text
    return load_workbook(io.BytesIO(antwort.content))


def _datei(mappe) -> bytes:
    puffer = io.BytesIO()
    mappe.save(puffer)
    return puffer.getvalue()


def _hochladen(inhalt):
    return {"datei": ("tabelle.xlsx", inhalt, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}


def _vorschau(client, name, inhalt):
    antwort = client.post(f"/api/tabellen/{name}/import/vorschau", files=_hochladen(inhalt))
    assert antwort.status_code == 200, antwort.text
    return antwort.json()


def _importieren(client, name, inhalt):
    v = _vorschau(client, name, inhalt)
    antwort = client.post(f"/api/tabellen/{name}/import", files=_hochladen(inhalt), data={"pruefsumme": v["pruefsumme"]})
    assert antwort.status_code == 200, antwort.text
    return v, antwort.json()


def _spalte(blatt, kopf):
    return next(i for i, z in enumerate(blatt[1]) if z.value == kopf)


def _zeile(blatt, schluessel):
    return next(z for z in blatt.iter_rows(min_row=2) if z[0].value == schluessel)


def test_export_einheitlich_und_nur_fachpruefer_admin(client, fachpruefer, aussendienst):
    anmelden(client, aussendienst.email)
    assert client.get("/api/tabellen/raumtypen/export.xlsx").status_code == 403
    assert client.post("/api/tabellen/raumtypen/import/vorschau", files=_hochladen(b"x")).status_code == 403
    anmelden(client, fachpruefer.email)
    for name, blatt in TABELLEN.items():
        mappe = _export(client, name)
        assert mappe.sheetnames == [blatt, "Hinweise"], name
        assert mappe[blatt].freeze_panes == "A2"
        assert mappe["Hinweise"]["A1"].value.startswith(blatt)
    kopf = [z.value for z in _export(client, "objekte")["Objektbibliothek"][1]]
    assert kopf[:4] == ["Name", "Gruppe", "Form", "Breite (m)"] and "Quelle" in kopf and "aktiv" in kopf
    assert _export(client, "objekte")["Objektbibliothek"]["B2"].value == "Möbel"


def test_raumtypen_pauschale_vorschau_betroffene_projekte_und_protokoll(client, db, fachpruefer, projekt):  # noqa: F811
    anmelden(client, fachpruefer.email)
    wohnen = _post(client, "/api/fachvorgaben/raumtypen", {"bezeichnung": "TESTWOHNEN", "quelle": "TESTWERT"})
    client.put("/api/fachvorgaben/pauschalen", json={"raumtyp_id": wohnen["id"], "gebaeudestandard": "neubau", "w_m2": 50, "quelle": "TESTWERT"})
    client.post(f"/api/projekte/{projekt['projekt']['id']}/vorgaben/uebernehmen")
    _raum(client, projekt, raumtyp_id=wohnen["id"])  # 4 × 5 m → 1 000 W
    mappe = _export(client, "raumtypen")
    blatt = mappe["Raumtypen"]
    z = _zeile(blatt, "TESTWOHNEN")
    assert z[_spalte(blatt, "Pauschale Neubau (W/m²)")].value == 50
    z[_spalte(blatt, "Pauschale Neubau (W/m²)")].value = "60,5"
    z[_spalte(blatt, "Bemerkung")].value = "TEST Bemerkung"
    inhalt = _datei(mappe)

    v = _vorschau(client, "raumtypen", inhalt)
    assert (v["geaendert"], v["neu"], v["fehler"]) == (["TESTWOHNEN"], [], [])
    assert {(a["feldname"], a["alt"], a["neu"]) for a in v["aenderungen"]} == {
        ("Pauschale Neubau (W/m²)", 50, 60.5), ("Bemerkung", "", "TEST Bemerkung")}
    assert [b["projekt_id"] for b in v["betroffen"]] == [projekt["projekt"]["id"]]
    assert db.scalars(select(HeizlastPauschale.w_m2)).one() == 50  # Vorschau speichert nichts

    _, e = _importieren(client, "raumtypen", inhalt)
    assert (e["geaendert"], e["neu"], e["projekte_warten"]) == (1, 0, 1)
    assert client.get(f"/api/projekte/{projekt['projekt']['id']}").json()["vorgaben_offen"] is True
    assert _auswertung(client, projekt)["raeume"][0]["phi_massgeblich_w"] == pytest.approx(1000)  # eingefroren bis zur Übernahme
    eintraege = db.scalars(select(Protokoll).where(Protokoll.objektart.in_(["HeizlastPauschale", "BibRaumtyp"]))).all()
    assert any(e.aenderungen.get("w_m2") == [50, 60.5] and e.benutzer_id == fachpruefer.id for e in eintraege)
    assert any("bemerkung" in e.aenderungen for e in eintraege)


def test_fehler_mit_zeilennummer_und_nichts_uebernommen(client, db, fachpruefer):
    anmelden(client, fachpruefer.email)
    _post(client, "/api/fachvorgaben/raumtypen", {"bezeichnung": "TESTBAD", "quelle": "TESTWERT"})
    mappe = _export(client, "raumtypen")
    blatt = mappe["Raumtypen"]
    blatt.append(["TESTNEU", 40])  # Pauschale ohne Quelle
    blatt.append(["TESTNEU2", None, None, None, "warm"])  # keine Zahl
    blatt.append(["TESTBAD"])  # doppelt
    inhalt = _datei(mappe)
    v = _vorschau(client, "raumtypen", inhalt)
    assert [(f["zeile"], f["text"]) for f in v["fehler"]] == [
        (3, "Quelle Pauschale Neubau fehlt"),
        (4, "Raumtemperatur (°C): „warm“ ist keine Zahl"),
        (5, "„TESTBAD“ doppelt (auch in Zeile 2)"),
    ]
    antwort = client.post("/api/tabellen/raumtypen/import", files=_hochladen(inhalt), data={"pruefsumme": v["pruefsumme"]})
    assert antwort.status_code == 422 and "Fehler" in antwort.json()["detail"]
    assert db.scalars(select(BibRaumtyp.bezeichnung)).all() == ["TESTBAD"]
    # geänderte Datei seit der Vorschau
    antwort = client.post("/api/tabellen/raumtypen/import", files=_hochladen(inhalt), data={"pruefsumme": "abc"})
    assert antwort.status_code == 422


def test_regeln_feste_liste_grenzen_und_quelle(client, fachpruefer):
    anmelden(client, fachpruefer.email)
    mappe = _export(client, "regeln")
    blatt = mappe["Platzierungsregeln"]
    _zeile(blatt, "Mindestabstand Modul – Wand")[1].value = 45
    _zeile(blatt, "Mindestabstand Modul – Wand")[4].value = "TESTWERT"
    _zeile(blatt, "Thermostat je Raum (ja/nein)")[1].value = "vielleicht"
    _zeile(blatt, "Vorgabewert Emissionsgrad Modul (Wärmeverteilung)")[1].value = 1.2
    blatt.append(["Gibt es nicht", 1, None, None, "Q"])
    v = _vorschau(client, "regeln", _datei(mappe))
    texte = {f["schluessel"]: f["text"] for f in v["fehler"]}
    assert texte["Thermostat je Raum (ja/nein)"].startswith("Wert: „vielleicht“ statt ja/nein")
    assert texte["Vorgabewert Emissionsgrad Modul (Wärmeverteilung)"].startswith("Wert muss größer als 0 und höchstens 1 sein")
    assert "neue Einträge sind hier nicht vorgesehen" in texte["Gibt es nicht"]
    assert v["geaendert"] == ["Mindestabstand Modul – Wand"]
    # Einheit nur zur Information
    assert _zeile(blatt, "Vorgabewert Emissionsgrad Modul (Wärmeverteilung)")[2].value == "0–1, ohne Einheit"


def test_objekte_neu_deaktivieren_nie_loeschen(client, db, fachpruefer):
    anmelden(client, fachpruefer.email)
    _post(client, "/api/fachvorgaben/raumtypen", {"bezeichnung": "TESTBAD", "quelle": "TESTWERT"})
    mappe = _export(client, "objekte")
    blatt = mappe["Objektbibliothek"]
    _zeile(blatt, "Sofa")[_spalte(blatt, "aktiv")].value = "nein"
    _zeile(blatt, "Couchtisch")[_spalte(blatt, "Kategorie")].value = "tabu"
    blatt.append(["TEST Truhe", "Möbel", "Rechteck", 1.2, 0.5, 0.6, "Abstand", 20, "TESTBAD", 99, "TESTWERT", "ja"])
    blatt.append(["TEST Falsch", "Möbel", "Kreis", 1, 1, None, "tabu", 30, "Gibtsnicht", 1, "TESTWERT", "ja"])
    blatt.delete_rows(_zeile(blatt, "WC")[0].row)  # fehlende Zeile löscht nichts
    v = _vorschau(client, "objekte", _datei(mappe))
    assert v["neu"] == ["TEST Truhe"]
    falsch = next(f for f in v["fehler"] if f["schluessel"] == "TEST Falsch")["text"]
    assert "Form: „Kreis“ – erlaubt: Rechteck, Punkt, Streifen entlang Wand" in falsch and "Raumtyp „Gibtsnicht“ unbekannt" in falsch
    blatt.delete_rows(blatt.max_row)
    v = _vorschau(client, "objekte", _datei(mappe))
    assert v["fehler"] == []
    _, e = _importieren(client, "objekte", _datei(mappe))
    assert (e["neu"], e["geaendert"]) == (1, 2)
    o = {x.name: x for x in db.scalars(select(BibObjekt))}
    assert o["Sofa"].aktiv is False and o["Couchtisch"].kategorie == "tabu" and "WC" in o
    assert (o["TEST Truhe"].schluessel, o["TEST Truhe"].raumtyp_ids, o["TEST Truhe"].abstand_cm) == ("test_truhe", [
        db.scalars(select(BibRaumtyp.id)).one()], 20)


def test_klimadaten_und_u_werte_neu_mit_schluessel(client, db, fachpruefer):
    anmelden(client, fachpruefer.email)
    mappe = _export(client, "klimadaten")
    mappe["Klimadaten"].append([86150, "TESTORT", -12.5, 8.9, "TESTWERT"])
    mappe["Klimadaten"].append([None, "TESTORT2", 20, None, "TESTWERT"])
    v = _vorschau(client, "klimadaten", _datei(mappe))
    assert v["fehler"] == [{"zeile": 3, "schluessel": "TESTORT2", "text": "Norm-Außentemperatur 20 °C liegt nicht zwischen −40 und 10 °C"}]
    mappe["Klimadaten"].delete_rows(3)
    _importieren(client, "klimadaten", _datei(mappe))
    k = db.scalars(select(BibKlimadaten)).one()
    assert (k.plz, k.ort, k.theta_e) == ("86150", "TESTORT", -12.5)
    # erneuter Import derselben Zeile: unverändert, kein Duplikat
    mappe = _export(client, "klimadaten")
    assert _vorschau(client, "klimadaten", _datei(mappe))["unveraendert"] == 1
    mappe = _export(client, "bauteile")
    mappe["U-Werte"].append(["Außenwand", "TEST Mauerwerk", "", 0.0, "TESTWERT"])
    assert "U-Wert 0 liegt nicht zwischen 0,01 und 10" in _vorschau(client, "bauteile", _datei(mappe))["fehler"][0]["text"]


def test_modulkatalog_ueber_dieselben_adressen(client, fachpruefer):
    anmelden(client, fachpruefer.email)
    _post(client, "/api/bibliotheken/module", {"artikel_nr": "T-1", "bezeichnung": "TESTMODUL", "leistung_w": 500, "laenge_mm": 1000,
                                               "breite_mm": 500, "schutzart": "IP44", "quelle": "TESTWERT"})
    mappe = _export(client, "module")
    blatt = mappe["Modulkatalog"]
    spalte = _spalte(blatt, "Emissionsgrad (0–1, ohne Einheit)")
    blatt.cell(1, spalte + 1).value = "Emissionsgrad"  # frühere Überschrift wird erkannt
    _zeile(blatt, "T-1")[spalte].value = 1.5
    v = _vorschau(client, "module", _datei(mappe))
    assert v["fehler"][0]["schluessel"] == "T-1" and "Emissionsgrad" in v["fehler"][0]["text"]
    _zeile(blatt, "T-1")[spalte].value = 0.93
    v, e = _importieren(client, "module", _datei(mappe))
    assert v["aenderungen"][0]["schluessel"] == "T-1" and e["geaendert"] == 1
