"""Import der Importdatei des Auftraggebers (daten/IR-Planer_Importdaten_geprueft.xlsx) und Platzierungsregeln."""
import io
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook
from sqlalchemy import select

from app.cli import excel_importieren
from app.excel_import import ImportFehler, importiere_excel, schutzart_zahl
from app.models import BibModul, BibRaumtyp, Fachvorgaben, HeizlastPauschale, Platzierungsregel
from tests.conftest import anmelden

DATEI = Path(__file__).resolve().parent.parent / "daten" / "IR-Planer_Importdaten_geprueft.xlsx"


@pytest.fixture
def inhalt() -> bytes:
    return DATEI.read_bytes()


def test_echte_importdatei(db, inhalt):
    db.add_all([BibRaumtyp(bezeichnung="Wohnraum"), BibRaumtyp(bezeichnung="Technik")])
    db.commit()
    bericht = importiere_excel(db, inhalt, {"Wohnraum": "Wohnen"})
    db.commit()

    assert len(bericht.raumtypen_neu) == 11 and bericht.raumtypen_aktualisiert == ["Wohnen"]
    assert bericht.umbenannt == ["Wohnraum → Wohnen"]
    assert bericht.pauschalen == 24
    assert bericht.module_neu == 21
    bad = db.scalars(select(BibRaumtyp).where(BibRaumtyp.bezeichnung == "Bad")).one()
    assert (bad.theta_int, bad.luftwechsel, bad.richtwert_altbau_w_m2) == (24, 0.25, 150)
    assert bad.quelle == "Erfahrungswert Serek, Stand 14.10.2026"
    w = {p.gebaeudestandard: p.w_m2 for p in db.scalars(select(HeizlastPauschale).where(HeizlastPauschale.raumtyp_id == bad.id))}
    assert w == {"neubau": 60, "effizienzhaus_sanierung": 80}  # Altbau nie als Tabellenwert

    regeln = {r.schluessel: r for r in db.scalars(select(Platzierungsregel))}
    assert regeln["abstand_wand_cm"].wert == 50 and regeln["abstand_modul_cm"].wert == 40
    assert "bett_sperrflaeche" not in regeln  # seit 01.11.2026 in der Objektbibliothek
    assert regeln["bad_min_schutzart"].wert_text == "IP44"
    assert regeln["leistungsreserve_prozent"].wert == 10
    assert any("Bett als Sperrfläche (ja/nein)“ steht seit 01.11.2026 in der Objektbibliothek" in a for a in bericht.auffaelligkeiten)
    assert db.get(Fachvorgaben, 1).hoehe_hinweis_m == 2.65

    modul = db.scalars(select(BibModul).where(BibModul.artikel_nr == "RD-420-B")).one()
    assert (modul.leistung_w, modul.laenge_mm, modul.breite_mm, modul.schutzart, modul.bad_geeignet) == (420, 615, 615, "IP20", False)
    assert modul.vk_netto is None and modul.montagezeit_min is None

    text = bericht.text()
    assert "Technik" in text and "bleibt unverändert" in text
    assert "in der Objektbibliothek – Zeile übersprungen" in text
    assert "21 von 21 Modulen ohne EK/VK-Preis" in text

    # erneuter Import: nichts neu, alles aktualisiert
    bericht = importiere_excel(db, inhalt)
    assert bericht.raumtypen_neu == [] and bericht.module_neu == 0 and bericht.module_aktualisiert == 21


def test_probelauf_speichert_nichts(db, inhalt):
    text = excel_importieren(db, inhalt, [], probelauf=True)
    assert text.startswith("PROBELAUF")
    assert db.scalars(select(BibModul)).all() == []
    assert db.get(Platzierungsregel, "abstand_wand_cm").wert is None


def test_fehler_nichts_importiert(db, inhalt):
    mappe = load_workbook(io.BytesIO(inhalt))
    mappe["Modulkatalog"]["C2"] = "viel"  # Leistung keine Zahl
    mappe["Platzierungsregeln"]["E2"] = None  # Quelle fehlt
    puffer = io.BytesIO()
    mappe.save(puffer)
    with pytest.raises(ValueError) as fehler:
        excel_importieren(db, puffer.getvalue(), [], probelauf=False)
    assert "keine Zahl" in str(fehler.value) and "Quelle des Werts fehlt" in str(fehler.value)
    assert db.scalars(select(BibModul)).all() == []
    assert db.scalars(select(BibRaumtyp)).all() == []


def test_falsche_datei():
    leer = Workbook()
    puffer = io.BytesIO()
    leer.save(puffer)
    with pytest.raises(ImportFehler) as fehler:
        importiere_excel(None, puffer.getvalue())
    assert "Blatt „Raumtypen“ fehlt" in fehler.value.fehler


def test_umbenennen_prueft_namen(db, inhalt):
    with pytest.raises(ImportFehler) as fehler:
        importiere_excel(db, inhalt, {"Gibtsnicht": "Wohnen"})
    assert "Raumtyp „Gibtsnicht“ gibt es nicht" in fehler.value.fehler[0]


def test_schutzart():
    assert schutzart_zahl("IP44") == 44 and schutzart_zahl("ip 54") == 54 and schutzart_zahl("x") is None


# ── Regeln über die API ──


def test_regeln_lesen_und_pflegen(client, aussendienst, fachpruefer):
    anmelden(client, aussendienst.email)
    regeln = client.get("/api/fachvorgaben").json()["regeln"]
    assert regeln[0]["schluessel"] == "abstand_wand_cm" and regeln[0]["wert"] is None
    assert client.patch("/api/fachvorgaben/regeln/abstand_wand_cm", json={"wert": 50}).status_code == 403

    anmelden(client, fachpruefer.email)
    antwort = client.patch("/api/fachvorgaben/regeln/abstand_wand_cm", json={"wert": 50, "quelle": "TESTWERT"})
    assert antwort.status_code == 200 and antwort.json()["wert"] == 50
    assert client.patch("/api/fachvorgaben/regeln/gibtsnicht", json={"wert": 1}).status_code == 404
    eintrag = client.get("/api/fachvorgaben/protokoll").json()[0]
    assert eintrag["objektart"] == "Platzierungsregel" and eintrag["aenderungen"]["wert"] == [None, 50]


def test_regeln_im_projekt_eingefroren(client, aussendienst, fachpruefer):
    """Regeln sind eingefroren; eine neue Regel sperrt nur, wenn sie im Projekt etwas ändert (18.10.2026)."""
    modul = {"id": "m1", "artikel_nr": "T-1", "bezeichnung": "TESTMODUL", "leistung_w": 500, "laenge_m": 1.0,
             "breite_m": 0.5, "x": 0.2, "y": 2.0}
    anmelden(client, aussendienst.email)
    projekte = []
    for nummer, module in (("R-1", [modul]), ("R-2", [])):
        p = client.post("/api/projekte", json={"bezeichnung": nummer, "gebaeudestandard": "neubau"}).json()
        g = client.post(f"/api/objekte/{p['objekte'][0]['id']}/geschosse", json={"bezeichnung": "EG"}).json()
        client.post(f"/api/geschosse/{g['id']}/raeume", json={"bezeichnung": "Raum", "laenge_m": 4, "breite_m": 5, "module": module})
        projekte.append(p["id"])

    anmelden(client, fachpruefer.email)
    vorschau = client.post("/api/fachvorgaben/vorschau", json={"art": "regel", "ziel": "abstand_wand_cm", "daten": {"wert": 50}}).json()
    assert [b["bezeichnung"] for b in vorschau["betroffen"]] == ["R-1"] and vorschau["geprueft"] == 2
    assert vorschau["betroffen"][0]["neue_verstoesse"] == 1

    client.patch("/api/fachvorgaben/regeln/abstand_wand_cm", json={"wert": 50})
    # R-1: Modul 20 cm vor der Wand → neuer Regelverstoß → wartet; rechnet bis zur Entscheidung mit seinem Stand
    v = client.get(f"/api/projekte/{projekte[0]}/vorgaben").json()
    assert v["offen"] is True and v["vorgaben"]["regeln"][0]["wert"] is None
    assert {"bereich": "Platzierungsregel", "bezeichnung": "Mindestabstand Modul – Wand (cm)", "alt": None, "neu": 50} in v["unterschiede"]
    assert v["auswirkung"]["neue_verstoesse"] == 1
    # R-2 ohne Module: still übernommen
    v2 = client.get(f"/api/projekte/{projekte[1]}/vorgaben").json()
    assert v2["unterschiede"] == [] and v2["vorgaben"]["regeln"][0]["wert"] == 50

    v = client.post(f"/api/projekte/{projekte[0]}/vorgaben/uebernehmen").json()
    assert v["vorgaben"]["regeln"][0]["wert"] == 50


def test_modulkatalog_und_offline(client, db, aussendienst):
    db.add(BibModul(artikel_nr="T-1", bezeichnung="TESTMODUL", leistung_w=500, laenge_mm=1000, breite_mm=500,
                    schutzart="IP44", bad_geeignet=True, quelle="TESTWERT"))
    db.add(BibModul(artikel_nr="T-2", bezeichnung="ALT", leistung_w=300, laenge_mm=600, breite_mm=600,
                    quelle="TESTWERT", aktiv=False))
    db.commit()
    anmelden(client, aussendienst.email)
    assert [m["artikel_nr"] for m in client.get("/api/bibliotheken/module").json()] == ["T-2", "T-1"]
    assert [m["artikel_nr"] for m in client.get("/api/offline/vorgaben").json()["module"]] == ["T-1"]
