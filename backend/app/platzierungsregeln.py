"""Platzierungsregeln für Infrarot-Deckenmodule (Festlegung Auftraggeber 14.10.2026).

Feste Liste: Die App wertet jede Regel über ihren Schlüssel aus. Gepflegt werden nur Wert und Quelle
(Fachprüfer und Admins). Leerer Wert = „Vorgabe fehlt“; es wird nichts geschätzt.
Die Regeln werden wie die übrigen Fachvorgaben je Projekt eingefroren (app/vorgabenstand.py).

„Maximale Raumhöhe ohne Rückfrage“ ist keine eigene Regel, sondern die vorhandene zentrale Hinweis-Höhe
(Fachvorgaben.hoehe_hinweis_m), damit es nur einen Wert dafür gibt.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Regel:
    schluessel: str
    # Bezeichnung wie in der Importdatei (Blatt „Platzierungsregeln“, Spalte „Regel“)
    bezeichnung: str
    einheit: str
    # zahl: Wert als Zahl; janein: „ja“/„nein“; text: freier Text
    art: str


REGELN: tuple[Regel, ...] = (
    Regel("abstand_wand_cm", "Mindestabstand Modul – Wand", "cm", "zahl"),
    Regel("abstand_leuchte_cm", "Mindestabstand Modul – Leuchte / Spot", "cm", "zahl"),
    Regel("abstand_rauchmelder_cm", "Mindestabstand Modul – Rauchmelder", "cm", "zahl"),
    Regel("abstand_modul_cm", "Mindestabstand Modul – Modul", "cm", "zahl"),
    Regel("abstand_sitzplatz_cm", "Mindestabstand zu Sperrfläche Sitzplatz", "cm", "zahl"),
    Regel("bett_sperrflaeche", "Bett als Sperrfläche (ja/nein)", "ja/nein", "janein"),
    Regel("abstand_bett_cm", "Mindestabstand zu Sperrfläche Bett", "cm", "zahl"),
    Regel("abstand_hochschrank_cm", "Mindestabstand zu Hochschrank", "cm", "zahl"),
    Regel("abstand_dachschraege_cm", "Mindestabstand zu Dachschräge (Knick)", "cm", "zahl"),
    # nicht in der Importdatei vom 14.10.2026 – bis zur Festlegung „Vorgabe fehlt“
    Regel("abstand_dusche_cm", "Mindestabstand zu Dusche/Wanne", "cm", "zahl"),
    Regel("abstand_sonstiges_cm", "Mindestabstand zu sonstiger Sperrfläche", "cm", "zahl"),
    Regel("mindesthoehe_m", "Mindestraumhöhe für Deckenmontage", "m", "zahl"),
    Regel("leistungsreserve_prozent", "Leistungsreserve", "%", "zahl"),
    Regel("ueberdimensionierung_prozent", "Maximale Überdimensionierung", "%", "zahl"),
    Regel("thermostat_je_raum", "Thermostat je Raum (ja/nein)", "ja/nein", "janein"),
    Regel("bad_min_schutzart", "Bad: zulässige Module", "min. Schutzart", "text"),
    Regel("bevorzugte_lage", "Bevorzugte Lage im Raum", "Text", "text"),
    Regel("bevorzugte_ausrichtung", "Bevorzugte Ausrichtung", "Text", "text"),
)

NACH_SCHLUESSEL = {r.schluessel: r for r in REGELN}
NACH_BEZEICHNUNG = {r.bezeichnung: r for r in REGELN}
# Zeile der Importdatei, die auf die zentrale Hinweis-Höhe abgebildet wird
HINWEIS_HOEHE_BEZEICHNUNG = "Maximale Raumhöhe ohne Rückfrage"
