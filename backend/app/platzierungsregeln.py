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
    # Wärmeverteilung (Festlegung 01.11.2026): Höhe der Oberseite je Sperrflächen-Typ (Empfangsfläche)
    Regel("hoehe_sitzplatz_m", "Höhe Sitzplatz (Wärmeverteilung)", "m", "zahl"),
    Regel("hoehe_bett_m", "Höhe Bett (Wärmeverteilung)", "m", "zahl"),
    Regel("hoehe_hochschrank_m", "Höhe Hochschrank (Wärmeverteilung)", "m", "zahl"),
    Regel("hoehe_dusche_m", "Höhe Dusche/Wanne (Wärmeverteilung)", "m", "zahl"),
    Regel("hoehe_sonstiges_m", "Höhe sonstige Sperrfläche (Wärmeverteilung)", "m", "zahl"),
    # Vorgabewerte für Module ohne Katalogangaben – nur für die Wärmeverteilung, bis zur Pflege „Vorgabe fehlt“
    Regel("strahler_temperatur_c", "Vorgabewert Oberflächentemperatur Modul (Wärmeverteilung)", "°C", "zahl"),
    Regel("strahler_emissionsgrad", "Vorgabewert Emissionsgrad Modul (Wärmeverteilung)", "–", "zahl"),
    Regel("strahler_abstrahlwinkel_grad", "Vorgabewert Abstrahlwinkel Modul (Wärmeverteilung)", "°", "zahl"),
)

# Zulässiger Bereich je Regel (min, max, min ausgeschlossen); sonst 0 … 1000
GRENZEN: dict[str, tuple[float, float, bool]] = {
    "strahler_emissionsgrad": (0, 1, True),
    "strahler_abstrahlwinkel_grad": (0, 180, True),
    "strahler_temperatur_c": (0, 400, True),
    **{f"hoehe_{t}_m": (0, 5, False) for t in ("sitzplatz", "bett", "hochschrank", "dusche", "sonstiges")},
}

NACH_SCHLUESSEL = {r.schluessel: r for r in REGELN}
NACH_BEZEICHNUNG = {r.bezeichnung: r for r in REGELN}
# Zeile der Importdatei, die auf die zentrale Hinweis-Höhe abgebildet wird
HINWEIS_HOEHE_BEZEICHNUNG = "Maximale Raumhöhe ohne Rückfrage"
