"""CSV-Import. Alle Zahlen sind TESTWERTE (Fantasiewerte), keine Norm- oder Pauschalwerte."""
from app.csv_import import importiere, lese_csv
from app.models import BibBauteil

BAUTEILE_CSV = (
    "﻿kategorie;bezeichnung;baualtersklasse;u_wert;quelle;bemerkung\n"
    "Außenwand;TESTWERT Wand;bis 1918;1,7;TESTWERT;\n"
    "Fenster;TESTWERT Fenster;;2.8;TESTWERT;Dezimalpunkt\n"
)


def test_bauteile_lesen_mit_komma_und_punkt():
    e = lese_csv("bauteile", BAUTEILE_CSV)
    assert e.fehler == []
    assert [z["u_wert"] for z in e.zeilen] == [1.7, 2.8]
    assert e.zeilen[1]["baualtersklasse"] == ""


def test_fehlende_spalte_und_quelle():
    e = lese_csv("raumtypen", "bezeichnung;theta_int;quelle\nTESTWERT;20;TESTWERT\n")
    assert any("luftwechsel" in f for f in e.fehler)
    e = lese_csv("raumtypen", "bezeichnung;theta_int;luftwechsel;quelle\nTESTWERT;20;0,5;\n")
    assert e.fehler == ["Zeile 2: „quelle“ fehlt"]


def test_unplausible_und_falsche_zahlen():
    e = lese_csv("klimadaten", "plz;ort;theta_e;quelle\n00000;TESTORT;-120;TESTWERT\n00001;TESTORT2;kalt;TESTWERT\n")
    assert len(e.fehler) == 2
    assert "außerhalb" in e.fehler[0]
    assert "keine Zahl" in e.fehler[1]


def test_doppelte_zeilen_werden_erkannt():
    e = lese_csv("raumtypen", "bezeichnung;theta_int;luftwechsel;quelle\nA;20;1;T\nA;21;1;T\n")
    assert "doppelt" in e.fehler[0]


def test_import_alles_oder_nichts_und_aktualisieren(db):
    fehlerhaft = BAUTEILE_CSV + "Dach;TESTWERT Dach;;abc;TESTWERT;\n"
    assert importiere(db, "bauteile", fehlerhaft)[0:2] == (0, 0)
    assert db.query(BibBauteil).count() == 0

    assert importiere(db, "bauteile", BAUTEILE_CSV) == (2, 0, [])
    geaendert = BAUTEILE_CSV.replace("1,7", "1,6")
    assert importiere(db, "bauteile", geaendert) == (0, 2, [])
    assert db.query(BibBauteil).filter_by(bezeichnung="TESTWERT Wand").one().u_wert == 1.6
