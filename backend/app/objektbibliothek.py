"""Objektbibliothek (Festlegung Auftraggeber 01.11.2026): Möbel, Deckeneinbauten und Bauliches für den Deckenplan.

Ersetzt die festen Sperrflächen-Typen. Gepflegt von Fachprüfern und Admins (Fachvorgaben), je Projekt eingefroren
wie die übrigen Fachvorgaben (app/vorgabenstand.py). Je Objekt bestimmt die Kategorie die Regelprüfung im Rechenkern:
tabu = kein Modul darüber + Mindestabstand, abstand = Modul erlaubt, aber Mindestabstand zur Kante, neutral = nur
Darstellung und Wärmeverteilung (Höhe).

START ist die Startausstattung vom 01.11.2026 (genutzt von der Migration b7d1e5a3c2f8 und den Tests) – nicht
nachträglich ändern; spätere Änderungen laufen über die Pflege in den Fachvorgaben.
"""
import re
import unicodedata
from dataclasses import dataclass

GRUPPEN = {"moebel": "Möbel", "decke": "Deckeneinbauten", "baulich": "Bauliches"}
FORMEN = {"rechteck": "Rechteck", "punkt": "Punkt", "streifen": "Streifen entlang Wand"}
KATEGORIEN = {"tabu": "tabu", "abstand": "Abstand", "neutral": "neutral"}

QUELLE_NEU = "Vorgabe – von Serek prüfen, Stand 01.11.2026"


@dataclass(frozen=True)
class StartObjekt:
    schluessel: str
    name: str
    gruppe: str
    raumtypen: tuple[str, ...]  # Bezeichnungen der Raumtypen; leer = alle
    form: str
    breite_m: float | None
    tiefe_m: float | None
    hoehe_m: float | None
    kategorie: str
    abstand_cm: float | None


WOHNEN = ("Wohnen", "Kinderzimmer", "Gästezimmer")
SCHLAFEN = ("Schlafen", "Kinderzimmer", "Gästezimmer")
BAD = ("Bad", "WC")

START: tuple[StartObjekt, ...] = (
    # Möbel – Reihenfolge innerhalb der Raumtypen wie gewünscht (im Bad zuerst Dusche, Badewanne, Waschtisch, WC)
    StartObjekt("sitzplatz", "Sitzplatz (allgemein)", "moebel", ("Wohnen", "Essen", "Arbeiten/Büro", "Kinderzimmer", "Gästezimmer"),
                "rechteck", 2.00, 0.90, 0.45, "tabu", 30),
    StartObjekt("sofa", "Sofa", "moebel", WOHNEN, "rechteck", 2.20, 0.90, 0.45, "tabu", 30),
    StartObjekt("sessel", "Sessel", "moebel", WOHNEN, "rechteck", 0.85, 0.85, 0.45, "tabu", 30),
    StartObjekt("esstisch", "Esstisch", "moebel", ("Essen", "Küche", "Wohnen"), "rechteck", 1.60, 0.90, 0.75, "tabu", 30),
    StartObjekt("schreibtisch", "Schreibtisch", "moebel", ("Arbeiten/Büro", "Kinderzimmer", "Gästezimmer"),
                "rechteck", 1.40, 0.70, 0.75, "tabu", 30),
    StartObjekt("bett", "Bett", "moebel", SCHLAFEN, "rechteck", 1.80, 2.00, 0.50, "tabu", 30),
    StartObjekt("couchtisch", "Couchtisch", "moebel", WOHNEN, "rechteck", 1.10, 0.60, 0.45, "neutral", None),
    StartObjekt("tv_board", "TV-Board", "moebel", WOHNEN, "rechteck", 1.80, 0.45, 0.50, "neutral", None),
    StartObjekt("nachttisch", "Nachttisch", "moebel", SCHLAFEN, "rechteck", 0.50, 0.40, 0.55, "neutral", None),
    StartObjekt("regal", "Regal", "moebel", ("Wohnen", "Arbeiten/Büro", "Kinderzimmer", "Flur/Diele", "Abstellraum", "Hauswirtschaft"),
                "rechteck", 1.00, 0.40, 2.00, "abstand", 30),
    StartObjekt("kleiderschrank", "Kleiderschrank", "moebel", ("Schlafen", "Kinderzimmer", "Gästezimmer", "Flur/Diele"),
                "rechteck", 2.00, 0.60, 2.20, "abstand", 30),
    StartObjekt("hochschrank", "Hochschrank", "moebel",
                ("Wohnen", "Schlafen", "Arbeiten/Büro", "Flur/Diele", "Abstellraum", "Hauswirtschaft", "Bad", "Technik"),
                "rechteck", 0.60, 0.60, 2.00, "abstand", 30),
    StartObjekt("kuechenzeile", "Küchenzeile", "moebel", ("Küche",), "rechteck", 2.40, 0.60, 0.90, "neutral", None),
    StartObjekt("haengeschraenke", "Hängeschränke", "moebel", ("Küche",), "rechteck", 2.40, 0.35, 2.15, "abstand", 30),
    StartObjekt("kuehlschrank", "Kühlschrank/Hochschrank Küche", "moebel", ("Küche",), "rechteck", 0.60, 0.60, 2.15, "abstand", 30),
    StartObjekt("dunstabzug", "Dunstabzug", "moebel", ("Küche",), "rechteck", 0.90, 0.50, 2.20, "abstand", 30),
    StartObjekt("dusche", "Dusche", "moebel", ("Bad",), "rechteck", 0.90, 0.90, 0.00, "tabu", 30),
    StartObjekt("badewanne", "Badewanne", "moebel", ("Bad",), "rechteck", 1.70, 0.75, 0.55, "tabu", 30),
    StartObjekt("waschtisch", "Waschtisch", "moebel", BAD, "rechteck", 0.80, 0.50, 0.85, "neutral", None),
    StartObjekt("wc", "WC", "moebel", BAD, "rechteck", 0.40, 0.65, 0.40, "neutral", None),
    StartObjekt("spiegelschrank", "Spiegelschrank", "moebel", BAD, "rechteck", 0.80, 0.15, 2.00, "abstand", 30),
    StartObjekt("sonstiges", "Sonstige Sperrfläche", "moebel", (), "rechteck", 1.00, 1.00, 0.75, "tabu", 30),
    # Deckeneinbauten (Punkte)
    StartObjekt("leuchte", "Leuchte", "decke", (), "punkt", None, None, None, "tabu", 50),
    StartObjekt("spot", "Spot", "decke", (), "punkt", None, None, None, "tabu", 50),
    StartObjekt("rauchmelder", "Rauchmelder", "decke", (), "punkt", None, None, None, "tabu", 50),
    StartObjekt("lautsprecher", "Lautsprecher", "decke", (), "punkt", None, None, None, "tabu", 30),
    StartObjekt("lueftungsauslass", "Lüftungsauslass", "decke", (), "punkt", None, None, None, "tabu", 30),
    # Bauliches
    StartObjekt("dachschraege", "Dachschräge", "baulich", (), "streifen", 1.00, None, None, "abstand", 40),
    StartObjekt("dachfenster", "Dachfenster", "baulich", (), "rechteck", 0.80, 1.20, None, "tabu", 30),
    StartObjekt("unterzug", "Unterzug", "baulich", (), "streifen", 0.25, None, None, "abstand", 30),
)

# Frühere feste Sperrflächen-Typen → Platzierungsregeln, deren Werte die Startausstattung übernimmt (Abstand, Höhe)
FRUEHERE_REGELN: dict[str, tuple[str, str | None]] = {
    "sitzplatz": ("abstand_sitzplatz_cm", "hoehe_sitzplatz_m"),
    "bett": ("abstand_bett_cm", "hoehe_bett_m"),
    "hochschrank": ("abstand_hochschrank_cm", "hoehe_hochschrank_m"),
    "dachschraege": ("abstand_dachschraege_cm", None),
    "dusche": ("abstand_dusche_cm", "hoehe_dusche_m"),
    "sonstiges": ("abstand_sonstiges_cm", "hoehe_sonstiges_m"),
    "leuchte": ("abstand_leuchte_cm", None),
    "rauchmelder": ("abstand_rauchmelder_cm", None),
}
# Platzierungsregeln, die seit 01.11.2026 in der Objektbibliothek stehen
ABGELOESTE_REGELN = (
    *{r for paar in FRUEHERE_REGELN.values() for r in paar if r}, "bett_sperrflaeche",
)


def schluessel_aus_name(name: str, vergeben: set[str]) -> str:
    """Stabiler Schlüssel für ein neues Objekt (Kleinbuchstaben, Ziffern, _), eindeutig."""
    text = name.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    basis = re.sub(r"[^a-z0-9]+", "_", text).strip("_")[:40] or "objekt"
    kandidat, n = basis, 2
    while kandidat in vergeben:
        kandidat, n = f"{basis}_{n}", n + 1
    return kandidat
