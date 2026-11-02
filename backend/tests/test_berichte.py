"""Berichte (Paket M4, 02.11.2026): Ergebnisbericht (PDF), Bestellliste und Kalkulation (Excel). TESTWERTE."""
import io

import pytest
from openpyxl import load_workbook

import app.logo as logo
from app.berichte.daten import sammeln
from app.models import Projekt
from tests.conftest import _benutzer, anmelden
from tests.test_firmen import _png
from tests.test_projekt import _patch, _post, _raum, _uebernehmen, projekt  # noqa: F401  (Fixture)


def _modul(nr, x, y, leistung, artikel="T-1"):
    return {"id": f"m{nr}", "modul_id": None, "artikel_nr": artikel, "bezeichnung": f"TESTMODUL {artikel}", "leistung_w": leistung,
            "laenge_m": 1.0, "breite_m": 0.6, "schutzart": "IP44", "bad_geeignet": True, "x": x, "y": y, "gedreht": False}


@pytest.fixture
def geplant(client, db, projekt, fachpruefer, aussendienst, tmp_path, monkeypatch):  # noqa: F811
    """Drei Räume (TESTWERTE, Rückfall 45 W/m²): 4 × 5 m = 900 W mit 1 000 W (OK), 3 × 3 m = 405 W mit 600 W (Prüfen),
    4 × 4 m = 720 W mit 500 W (Unterdeckt)."""
    monkeypatch.setattr(logo, "ORDNER", tmp_path / "logos")
    anmelden(client, fachpruefer.email)
    for schluessel, wert in (("abstand_wand_cm", 50), ("abstand_modul_cm", 40), ("leistungsreserve_prozent", 10)):
        client.patch(f"/api/fachvorgaben/regeln/{schluessel}", json={"wert": wert, "quelle": "TESTWERT"})
    client.patch("/api/fachvorgaben/regeln/thermostat_je_raum", json={"wert_text": "ja", "quelle": "TESTWERT"})
    _uebernehmen(client, projekt, fachpruefer)
    anmelden(client, aussendienst.email)
    _patch(client, f"/api/projekte/{projekt['projekt']['id']}", {"kunde_name": "Müller & Söhne"})
    for name, (l, b), leistung in (("Wohnen", (4, 5), 1000), ("Büro", (3, 3), 600), ("Kind", (4, 4), 500)):
        r = _raum(client, projekt, bezeichnung=name, laenge_m=l, breite_m=b)
        _patch(client, f"/api/raeume/{r['id']}", {"module": [_modul(1, 1, 1, leistung)],
                                                  "sperrflaechen": [{"id": "s", "objekt": "sofa", "x": 2.5, "y": 2.5, "b": 1, "t": 0.9}]})
    return projekt


def test_berichtsdaten_aus_dem_rechenkern_ohne_preise(db, geplant):
    d = sammeln(db, db.get(Projekt, geplant["projekt"]["id"]))
    status = [(rb.a["bezeichnung"], rb.a["modulplanung"]["bericht_status"], round(rb.a["modulplanung"]["reserve_prozent"])) for rb in d.raeume]
    assert status == [("Wohnen", "ok", 11), ("Büro", "pruefen", 48), ("Kind", "unterdeckt", -31)]
    assert d.summe["installiert_w"] == 2100 and d.summe["phi_massgeblich_w"] == 2025
    assert d.status_text == "Vor-Ort-Entwurf" and "nicht fachlich geprüft" in d.pruefvermerk
    assert "ek" not in str(d.summe) and "vk_netto" not in str([rb.a for rb in d.raeume])


def test_ergebnisbericht_pdf_sichtbarkeit_und_dateiname(client, db, geplant, aussendienst, admin):
    anmelden(client, aussendienst.email)
    antwort = client.get(f"/api/projekte/{geplant['projekt']['id']}/berichte/ergebnis.pdf")
    assert antwort.status_code == 200 and antwort.content.startswith(b"%PDF")
    assert antwort.headers["content-type"] == "application/pdf"
    nr = geplant["projekt"]["nummer"]
    assert f"filename*=UTF-8''Ergebnisbericht_{nr}_M%C3%BCller_S%C3%B6hne.pdf" in antwort.headers["content-disposition"]
    assert antwort.content.count(b"/Type /Page\n") + antwort.content.count(b"/Type /Page ") + antwort.content.count(b"/Type /Page>") >= 2
    # anderer Außendienst sieht das Projekt nicht
    _benutzer(db, "fremd@test.invalid", "aussendienst")
    anmelden(client, "fremd@test.invalid")
    assert client.get(f"/api/projekte/{geplant['projekt']['id']}/berichte/ergebnis.pdf").status_code == 404
    # mit Firma und Logo
    anmelden(client, admin.email)
    f = _post(client, "/api/firmen", {"name": "TEST GmbH", "standard": True, "strasse": "Teststraße 1", "plz": "00000", "ort": "Testort"})
    client.post(f"/api/firmen/{f['id']}/logo", files={"datei": ("l.png", _png(300, 100), "image/png")})
    assert client.get(f"/api/projekte/{geplant['projekt']['id']}/berichte/ergebnis.pdf").content.startswith(b"%PDF")


def test_bestellliste_formeln_eingaben_druck(client, geplant, aussendienst):
    anmelden(client, aussendienst.email)
    antwort = client.get(f"/api/projekte/{geplant['projekt']['id']}/berichte/bestellliste.xlsx")
    assert antwort.status_code == 200
    mappe = load_workbook(io.BytesIO(antwort.content))
    assert mappe.sheetnames == ["Bestellliste", "Blattstückliste"]
    b, s = mappe["Bestellliste"], mappe["Blattstückliste"]
    assert [c.value for c in b[4]][:6] == ["Art.-Nr.", "Artikel", "Leistung je Stück (W)", "Menge laut Blattstückliste", "Zusatz (Reserve)", "Bestellmenge"]
    assert (b["A5"].value, b["D5"].value, b["E5"].value, b["F5"].value) == (
        "T-1", "=SUMIF('Blattstückliste'!$D:$D,$G5,'Blattstückliste'!$H:$H)", 0, "=D5+E5")
    assert b["E5"].fill.fgColor.rgb.endswith("FFF2B3") and b["E5"].font.color.rgb.endswith("1F4FD1")
    assert b["B6"].value == "Raumthermostat" and b["A6"].fill.fgColor.rgb.endswith("FFF2B3")  # Art.-Nr. als Eingabe
    zeilen = [[c.value for c in z] for z in s.iter_rows(min_row=5) if z[0].value]
    assert [(z[2], z[3], z[7]) for z in zeilen] == [("Wohnen", "modul:T-1", 1), ("Wohnen", "raumthermostat", 1), ("Büro", "modul:T-1", 1),
                                                     ("Büro", "raumthermostat", 1), ("Kind", "modul:T-1", 1), ("Kind", "raumthermostat", 1)]
    assert b.page_setup.orientation == "landscape" and b.page_setup.fitToWidth == 1 and b.print_title_rows == "$1:$4"
    assert f"Projekt {geplant['projekt']['nummer']}" in b.oddHeader.right.text and "Seite &P von &N" == b.oddFooter.right.text
    assert not any("€" in str(c.value) or "EK" in str(c.value) for z in b.iter_rows() for c in z)


def test_kalkulation_recht_preisstand_eingefroren_und_formeln(client, db, geplant, aussendienst, fachpruefer, admin):
    pid = geplant["projekt"]["id"]
    for wer in (aussendienst, fachpruefer):
        anmelden(client, wer.email)
        assert client.get(f"/api/projekte/{pid}/berichte/kalkulation.xlsx").status_code == 403
        assert client.get("/api/artikel").status_code == 403
    anmelden(client, admin.email)
    _patch(client, "/api/artikel/raumthermostat", {"ek_netto": 50, "vk_netto": 80})
    antwort = client.get(f"/api/projekte/{pid}/berichte/kalkulation.xlsx")
    assert antwort.status_code == 200 and f"Kalkulation_intern_{geplant['projekt']['nummer']}" in antwort.headers["content-disposition"]
    mappe = load_workbook(io.BytesIO(antwort.content))
    assert mappe.sheetnames == ["Kalkulation", "Preise", "Blattstückliste"]
    k = mappe["Kalkulation"]
    assert k["A5"].value.startswith('=IF(COUNTIF(K6:K') and "Preis fehlt" in k["A5"].value
    assert k["D6"].value.startswith("=SUMIFS('Blattstückliste'!$G:$G") and 'Preis fehlt' in k["E6"].value
    assert k["J6"].value.startswith("=IF(AND(ISNUMBER(I6)")  # Marge % = Marge € / VK
    positionen = [k.cell(r, 3).value for r in range(6, k.max_row) if k.cell(r, 3).value]
    assert positionen.count("elektroanschluss") == 3 and positionen.count("anfahrt") == 1 and positionen.count("raumthermostat") == 3
    preise = {z[0].value: (z[4].value, z[5].value) for z in mappe["Preise"].iter_rows(min_row=5) if z[0].value}
    assert preise["raumthermostat"] == (50, 80) and preise["modul:T-1"] == (None, None)  # leer = Preis fehlt, nie 0
    # spätere Preisänderung ändert die eingefrorene Kalkulation nicht – erst nach bewusster Aktualisierung
    _patch(client, "/api/artikel/raumthermostat", {"ek_netto": 60})
    neu = load_workbook(io.BytesIO(client.get(f"/api/projekte/{pid}/berichte/kalkulation.xlsx").content))["Preise"]
    assert {z[0].value: z[4].value for z in neu.iter_rows(min_row=5) if z[0].value}["raumthermostat"] == 50
    assert client.post(f"/api/projekte/{pid}/preisstand").json()["eingefroren"] is True
    neu = load_workbook(io.BytesIO(client.get(f"/api/projekte/{pid}/berichte/kalkulation.xlsx").content))["Preise"]
    assert {z[0].value: z[4].value for z in neu.iter_rows(min_row=5) if z[0].value}["raumthermostat"] == 60
    # Recht je Benutzer
    anmelden(client, admin.email)
    assert _patch(client, f"/api/benutzer/{fachpruefer.id}", {"kalkulation_sehen": True})["darf_kalkulation"] is True
    anmelden(client, fachpruefer.email)
    assert client.get(f"/api/projekte/{pid}/berichte/kalkulation.xlsx").status_code == 200


def test_preise_im_katalog_nur_mit_recht(client, admin, fachpruefer):
    anmelden(client, admin.email)
    m = _post(client, "/api/bibliotheken/module", {"artikel_nr": "T-9", "bezeichnung": "TEST", "leistung_w": 500, "laenge_mm": 1000,
                                                   "breite_mm": 500, "schutzart": "IP44", "quelle": "TESTWERT", "ek_netto": 100, "vk_netto": 150})
    assert m["ek_netto"] == 100
    anmelden(client, fachpruefer.email)
    sicht = next(x for x in client.get("/api/bibliotheken/module").json() if x["artikel_nr"] == "T-9")
    assert (sicht["ek_netto"], sicht["vk_netto"]) == (None, None)
    assert client.patch(f"/api/bibliotheken/module/{m['id']}", json={"ek_netto": 1}).status_code == 403
    assert client.patch(f"/api/bibliotheken/module/{m['id']}", json={"bemerkung": "TEST"}).status_code == 200
    kopf = [c.value for c in load_workbook(io.BytesIO(client.get("/api/tabellen/module/export.xlsx").content))["Modulkatalog"][1]]
    assert "EK netto (€)" not in kopf and "VK netto (€)" not in kopf
    anmelden(client, admin.email)
    assert next(x for x in client.get("/api/bibliotheken/module").json() if x["artikel_nr"] == "T-9")["ek_netto"] == 100


def test_sonstige_sperrflaeche_rund_im_bericht(client, db, geplant, aussendienst):
    """Paket N4: Name, Form und eigene Kategorie gespeichert; Bericht mit runder Fläche wird erzeugt."""
    anmelden(client, aussendienst.email)
    raum = client.get(f"/api/objekte/{geplant['objekt']['id']}/auswertung").json()["raeume"][0]
    kamin = {"id": "k", "objekt": "sonstiges", "bezeichnung": "Kamin", "umriss": "rund", "kategorie": "abstand", "x": 2, "y": 2, "b": 1, "t": 1}
    r = _patch(client, f"/api/raeume/{raum['raum_id']}", {"sperrflaechen": [kamin]})
    assert {k: r["sperrflaechen"][0][k] for k in ("bezeichnung", "umriss", "kategorie")} == {"bezeichnung": "Kamin", "umriss": "rund", "kategorie": "abstand"}
    assert client.patch(f"/api/raeume/{raum['raum_id']}", json={"sperrflaechen": [{**kamin, "umriss": "oval"}]}).status_code == 422
    assert client.get(f"/api/projekte/{geplant['projekt']['id']}/berichte/ergebnis.pdf").content.startswith(b"%PDF")
