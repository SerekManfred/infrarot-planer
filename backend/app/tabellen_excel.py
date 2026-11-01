"""Excel-Export und -Import für alle Tabellen der Fachvorgaben (Festlegung Auftraggeber 01.11.2026, Paket L).

Einheitlicher Aufbau jeder Datei:
- Blatt mit dem Tabellennamen, erste Zeile = Spaltenüberschriften mit Einheit, alle Felder (auch die in der Tabelle
  ausgeblendeten),
- Blatt „Hinweise“ mit Erklärung jeder Spalte (Pflicht, erlaubte Werte).

Import wie beim Modulkatalog (app/modul_import.py):
- Zuordnung über einen eindeutigen Schlüssel (Name, Bezeichnung bzw. PLZ/Ort …); fehlende Spalten bleiben unverändert,
- erst Vorschau (neu / geändert / unverändert, Änderungen alt → neu, Fehler mit Zeilennummer und Begründung),
  Übernahme nur fehlerfrei und nur für genau die geprüfte Datei (Prüfsumme),
- über den Import wird nie gelöscht (Objektbibliothek: höchstens „aktiv“ = nein). Eine leere Pauschale bedeutet wie in
  der Oberfläche „kein Tabellenwert“ (dann gilt der Rückfallwert),
- jede Änderung wird je Feld protokolliert (app/protokoll.py); vor der Übernahme sichert der Endpunkt die Datenbank,
- Tabellen der Fachvorgaben (Raumtypen/Pauschalen, Platzierungsregeln, Objektbibliothek): Die Vorschau zeigt die
  betroffenen Projekte, nach der Übernahme läuft der bekannte Abgleich (app/vorgabenabgleich.py).
"""
import hashlib
import io
from dataclasses import dataclass, field
from datetime import date

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.fehlertexte import eingabefehler_text
from app.models import BibBauteil, BibKlimadaten, BibObjekt, BibRaumtyp, HeizlastPauschale, Platzierungsregel
from app.objektbibliothek import FORMEN, GRUPPEN, KATEGORIEN, schluessel_aus_name
from app.platzierungsregeln import GRENZEN, NACH_BEZEICHNUNG
from app.schemas import BibObjektNeu, RaumtypNeu


class ImportAbgelehnt(Exception):
    def __init__(self, meldung: str, fehler: list[dict] | None = None):
        super().__init__(meldung)
        self.fehler = fehler or []


@dataclass(frozen=True)
class Spalte:
    kopf: str
    feld: str
    # text, zahl, ganzzahl, janein, auswahl (Anzeige → Wert), raumtypen (Komma-Liste der Namen), roh (Tabelle prüft)
    art: str = "text"
    pflicht: bool = False
    erklaerung: str = ""
    auswahl: dict[str, str] | None = None
    # nur zur Information im Export (z. B. Einheit einer Regel), beim Import ignoriert
    nur_export: bool = False
    # frühere Überschriften, die der Import ebenfalls erkennt
    alias: tuple[str, ...] = ()


@dataclass
class Tabelle:
    name: str
    blatt: str
    spalten: tuple[Spalte, ...]
    schluessel: tuple[str, ...]
    neu_erlaubt: bool = True
    # Teil der Fachvorgaben (je Projekt eingefroren): Vorschau der Projekte und Abgleich nach der Übernahme
    vorgaben: bool = False
    hinweis: str = ""
    nach_feld: dict[str, Spalte] = field(init=False)

    def __post_init__(self):
        self.nach_feld = {s.feld: s for s in self.spalten}

    # je Tabelle überschrieben
    def zeilen(self, db: Session) -> list[dict]:
        raise NotImplementedError

    def pruefen(self, db: Session, daten: dict, alt: dict | None) -> list[str]:
        return []

    def schreiben(self, db: Session, daten: dict, alt: dict | None) -> None:
        raise NotImplementedError

    # ── gemeinsame Hilfen ──
    def schluessel_von(self, daten: dict) -> tuple:
        return tuple("" if daten.get(f) is None else str(daten.get(f)).strip() for f in self.schluessel)

    def schluessel_text(self, schluessel: tuple) -> str:
        return " / ".join(str(t) for t in schluessel if t not in ("", None)) or "–"

    def anzeige(self, feld: str, wert, db: Session | None = None, namen: dict[int, str] | None = None):
        """Wert für Excel und Änderungsliste (Auswahl als Text, ja/nein, Raumtyp-Namen)."""
        s = self.nach_feld.get(feld)
        if s is None or wert is None:
            return wert
        if s.art == "janein":
            return "ja" if wert else "nein"
        if s.art == "auswahl" and s.auswahl:
            return next((k for k, v in s.auswahl.items() if v == wert), wert)
        if s.art == "raumtypen":
            return ", ".join((namen or {}).get(i, f"Raumtyp {i}") for i in wert)
        return wert


def _raumtyp_namen(db: Session) -> dict[int, str]:
    return {t.id: t.bezeichnung for t in db.scalars(select(BibRaumtyp))}


def _leer(wert) -> bool:
    return wert is None or (isinstance(wert, str) and not wert.strip())


def _gleich(a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) < 1e-9
    if isinstance(a, str) or isinstance(b, str):
        return (a or "") == (b or "")
    return a == b


def _gruende(fehler: ValidationError) -> str:
    return eingabefehler_text(fehler.errors()).removeprefix("Bitte Eingaben prüfen: ").removesuffix(".")


# ── Tabellen ──

PAUSCHALEN = (("neubau", "Neubau"), ("effizienzhaus_sanierung", "Effizienzhaus-Sanierung"))


class Raumtypen(Tabelle):
    def zeilen(self, db):
        pauschalen = {(p.raumtyp_id, p.gebaeudestandard): p for p in db.scalars(select(HeizlastPauschale))}
        ergebnis = []
        for t in db.scalars(select(BibRaumtyp).order_by(BibRaumtyp.reihenfolge, BibRaumtyp.bezeichnung)):
            z = {f: getattr(t, f) for f in ("bezeichnung", "richtwert_altbau_w_m2", "theta_int", "luftwechsel",
                                             "reduktionsfaktor", "reihenfolge", "quelle", "bemerkung")}
            for gs, _ in PAUSCHALEN:
                p = pauschalen.get((t.id, gs))
                z[f"pauschale_{gs}"] = p.w_m2 if p else None
                z[f"quelle_pauschale_{gs}"] = p.quelle if p else ""
            z["_id"] = t.id
            ergebnis.append(z)
        return ergebnis

    def pruefen(self, db, daten, alt):
        fehler = []
        try:
            RaumtypNeu.model_validate({k: daten.get(k) for k in ("bezeichnung", "theta_int", "luftwechsel", "reduktionsfaktor",
                                                                  "richtwert_altbau_w_m2")} | {"reihenfolge": daten.get("reihenfolge") or 0})
        except ValidationError as e:
            fehler.append(_gruende(e))
        for gs, text in PAUSCHALEN:
            w = daten.get(f"pauschale_{gs}")
            if w is not None and not 0 <= w <= 500:
                fehler.append(f"Pauschale {text}: {w:g} W/m² liegt nicht zwischen 0 und 500")
            if w is not None and _leer(daten.get(f"quelle_pauschale_{gs}")):
                fehler.append(f"Quelle Pauschale {text} fehlt")
        return fehler

    def schreiben(self, db, daten, alt):
        t = db.get(BibRaumtyp, alt["_id"]) if alt else BibRaumtyp(bezeichnung=daten["bezeichnung"])
        if alt is None:
            db.add(t)
        for f in ("bezeichnung", "richtwert_altbau_w_m2", "theta_int", "luftwechsel", "reduktionsfaktor", "quelle", "bemerkung"):
            setattr(t, f, daten.get(f) if daten.get(f) is not None or f not in ("quelle", "bemerkung") else "")
        t.reihenfolge = int(daten.get("reihenfolge") or 0)
        db.flush()
        for gs, _ in PAUSCHALEN:
            w = daten.get(f"pauschale_{gs}")
            p = db.scalars(select(HeizlastPauschale).where(
                HeizlastPauschale.raumtyp_id == t.id, HeizlastPauschale.gebaeudestandard == gs)).one_or_none()
            if w is None:
                if p is not None:
                    db.delete(p)  # leere Pauschale = kein Tabellenwert (Rückfallwert), wie in der Oberfläche
                continue
            if p is None:
                p = HeizlastPauschale(raumtyp_id=t.id, gebaeudestandard=gs)
                db.add(p)
            p.w_m2, p.quelle = w, (daten.get(f"quelle_pauschale_{gs}") or "").strip()


class Regeln(Tabelle):
    def zeilen(self, db):
        ergebnis = []
        for r in db.scalars(select(Platzierungsregel).order_by(Platzierungsregel.reihenfolge)):
            d = NACH_BEZEICHNUNG.get(r.bezeichnung)
            wert = r.wert if d is None or d.art == "zahl" else (r.wert_text or None)
            ergebnis.append({"bezeichnung": r.bezeichnung, "wert": wert, "einheit": r.einheit,
                             "erlaeuterung": r.erlaeuterung, "quelle": r.quelle, "_schluessel": r.schluessel})
        return ergebnis

    def pruefen(self, db, daten, alt):
        d = NACH_BEZEICHNUNG.get(daten["bezeichnung"])
        if d is None:
            return ["unbekannte Regel – die Liste der Regeln ist fest"]
        w = daten.get("wert")
        fehler = []
        if d.art == "zahl" and w is not None:
            if isinstance(w, str):
                try:
                    w = float(w.strip().replace(",", "."))
                except ValueError:
                    return [f"Wert: „{daten['wert']}“ ist keine Zahl"]
            unten, oben, ohne_unten = GRENZEN.get(d.schluessel, (0, 1000, False))
            if w > oben or w < unten or (ohne_unten and w == unten):
                fehler.append(f"Wert muss {'größer als' if ohne_unten else 'mindestens'} {unten:g} und höchstens {oben:g} sein")
            daten["wert"] = w
        elif d.art != "zahl" and w is not None:
            text = (w if isinstance(w, str) else f"{w:g}").strip()
            if d.art == "janein" and text.lower() not in ("ja", "nein"):
                fehler.append(f"Wert: „{text}“ statt ja/nein")
            daten["wert"] = text.lower() if d.art == "janein" else text
        if w is not None and _leer(daten.get("quelle")):
            fehler.append("Quelle fehlt")
        return fehler

    def schreiben(self, db, daten, alt):
        r = db.get(Platzierungsregel, alt["_schluessel"])
        d = NACH_BEZEICHNUNG[r.bezeichnung]
        if d.art == "zahl":
            r.wert, r.wert_text = daten.get("wert"), ""
        else:
            r.wert, r.wert_text = None, daten.get("wert") or ""
        r.erlaeuterung = daten.get("erlaeuterung") or ""
        r.quelle = daten.get("quelle") or ""


class Objekte(Tabelle):
    FELDER = ("name", "gruppe", "form", "breite_m", "tiefe_m", "hoehe_m", "kategorie", "abstand_cm", "raumtyp_ids",
              "reihenfolge", "quelle", "aktiv")

    def zeilen(self, db):
        return [{**{f: getattr(o, f) for f in self.FELDER}, "_id": o.id}
                for o in db.scalars(select(BibObjekt).order_by(BibObjekt.reihenfolge, BibObjekt.name))]

    def pruefen(self, db, daten, alt):
        if daten.get("aktiv") is None:
            daten["aktiv"] = True
        try:
            o = BibObjektNeu.model_validate({k: daten.get(k) for k in self.FELDER} | {"reihenfolge": daten.get("reihenfolge") or 0})
        except ValidationError as e:
            return [_gruende(e)]
        if o.form == "rechteck" and (o.breite_m is None or o.tiefe_m is None):
            return ["Rechteck: Breite und Tiefe angeben"]
        if o.form == "streifen" and o.breite_m is None:
            return ["Streifen: Breite angeben"]
        if o.form == "punkt":
            daten.update(breite_m=None, tiefe_m=None, hoehe_m=None)
        if o.form == "streifen":
            daten["tiefe_m"] = None
        return []

    def schreiben(self, db, daten, alt):
        if alt:
            o = db.get(BibObjekt, alt["_id"])
        else:
            o = BibObjekt(schluessel=schluessel_aus_name(daten["name"], set(db.scalars(select(BibObjekt.schluessel)))))
            db.add(o)
        for f in self.FELDER:
            setattr(o, f, daten.get(f))
        o.reihenfolge = int(daten.get("reihenfolge") or 0)


class Bauteile(Tabelle):
    FELDER = ("kategorie", "bezeichnung", "baualtersklasse", "u_wert", "quelle", "bemerkung")

    def zeilen(self, db):
        return [{**{f: getattr(b, f) for f in self.FELDER}, "_id": b.id}
                for b in db.scalars(select(BibBauteil).order_by(BibBauteil.kategorie, BibBauteil.bezeichnung))]

    def pruefen(self, db, daten, alt):
        u = daten.get("u_wert")
        return [] if u is None or 0.01 <= u <= 10 else [f"U-Wert {u:g} liegt nicht zwischen 0,01 und 10 W/(m²K)"]

    def schreiben(self, db, daten, alt):
        b = db.get(BibBauteil, alt["_id"]) if alt else BibBauteil()
        if alt is None:
            db.add(b)
        for f in self.FELDER:
            setattr(b, f, daten.get(f) if daten.get(f) is not None or f == "u_wert" else "")


class Klimadaten(Tabelle):
    FELDER = ("plz", "ort", "theta_e", "theta_m_e", "quelle")

    def zeilen(self, db):
        return [{**{f: getattr(k, f) for f in self.FELDER}, "_id": k.id}
                for k in db.scalars(select(BibKlimadaten).order_by(BibKlimadaten.plz, BibKlimadaten.ort))]

    def pruefen(self, db, daten, alt):
        fehler = []
        if daten.get("theta_e") is not None and not -40 <= daten["theta_e"] <= 10:
            fehler.append(f"Norm-Außentemperatur {daten['theta_e']:g} °C liegt nicht zwischen −40 und 10 °C")
        if daten.get("theta_m_e") is not None and not -10 <= daten["theta_m_e"] <= 25:
            fehler.append(f"Jahresmittel {daten['theta_m_e']:g} °C liegt nicht zwischen −10 und 25 °C")
        return fehler

    def schreiben(self, db, daten, alt):
        k = db.get(BibKlimadaten, alt["_id"]) if alt else BibKlimadaten()
        if alt is None:
            db.add(k)
        for f in self.FELDER:
            setattr(k, f, daten.get(f) if daten.get(f) is not None or f in ("theta_e", "theta_m_e") else "")


QUELLE = "Quelle des Werts (Pflicht), z. B. Norm, Herstellerdatenblatt oder „Erfahrungswert Serek, Stand …“"

TABELLEN: dict[str, Tabelle] = {
    "raumtypen": Raumtypen(
        "raumtypen", "Raumtypen", (
            Spalte("Raumtyp", "bezeichnung", pflicht=True, erklaerung="eindeutiger Name, Schlüssel für die Zuordnung"),
            Spalte("Pauschale Neubau (W/m²)", "pauschale_neubau", "zahl", erklaerung="leer = Rückfallwert des Gebäudestandards"),
            Spalte("Pauschale Effizienzhaus-Sanierung (W/m²)", "pauschale_effizienzhaus_sanierung", "zahl",
                   erklaerung="leer = Rückfallwert des Gebäudestandards"),
            Spalte("Richtwert Altbau (W/m²)", "richtwert_altbau_w_m2", "zahl", erklaerung="nur Orientierung für den Fachprüfer"),
            Spalte("Raumtemperatur (°C)", "theta_int", "zahl", erklaerung="Norm-Innentemperatur, 0–40"),
            Spalte("Luftwechsel (1/h)", "luftwechsel", "zahl", erklaerung="0–10, nur Kontrollrechnung"),
            Spalte("Korrekturfaktor (–)", "reduktionsfaktor", "zahl", erklaerung="angrenzender Raum, −1 bis 1,5"),
            Spalte("Reihenfolge", "reihenfolge", "ganzzahl", erklaerung="Anzeigereihenfolge (ganze Zahl)"),
            Spalte("Quelle", "quelle", erklaerung=QUELLE),
            Spalte("Bemerkung", "bemerkung"),
            Spalte("Quelle Pauschale Neubau", "quelle_pauschale_neubau", erklaerung="Pflicht, wenn eine Pauschale eingetragen ist"),
            Spalte("Quelle Pauschale Effizienzhaus-Sanierung", "quelle_pauschale_effizienzhaus_sanierung",
                   erklaerung="Pflicht, wenn eine Pauschale eingetragen ist"),
        ), ("bezeichnung",), vorgaben=True,
        hinweis="Altbau (nicht Effizienzhaus) hat keine Tabellenwerte – der Fachprüfer legt die Pauschale je Raum fest.",
    ),
    "regeln": Regeln(
        "regeln", "Platzierungsregeln", (
            Spalte("Regel", "bezeichnung", pflicht=True, erklaerung="feste Liste – neue Regeln sind nicht vorgesehen"),
            Spalte("Wert", "wert", "roh", erklaerung="Zahl, ja/nein oder Text je nach Regel; leer = Vorgabe fehlt"),
            Spalte("Einheit", "einheit", nur_export=True, erklaerung="nur zur Information, wird nicht eingelesen"),
            Spalte("Erläuterung", "erlaeuterung"),
            Spalte("Quelle", "quelle", erklaerung=QUELLE + "; Pflicht, wenn ein Wert eingetragen ist"),
        ), ("bezeichnung",), neu_erlaubt=False, vorgaben=True,
    ),
    "objekte": Objekte(
        "objekte", "Objektbibliothek", (
            Spalte("Name", "name", pflicht=True, erklaerung="eindeutiger Name, Schlüssel für die Zuordnung"),
            Spalte("Gruppe", "gruppe", "auswahl", pflicht=True, auswahl={v: k for k, v in GRUPPEN.items()},
                   erklaerung="Möbel, Deckeneinbauten oder Bauliches"),
            Spalte("Form", "form", "auswahl", pflicht=True, auswahl={v: k for k, v in FORMEN.items()},
                   erklaerung="Rechteck, Punkt oder Streifen entlang Wand"),
            Spalte("Breite (m)", "breite_m", "zahl", erklaerung="Standardbreite; Streifen: Tiefe ab der Wand"),
            Spalte("Tiefe (m)", "tiefe_m", "zahl", erklaerung="nur Rechteck"),
            Spalte("Höhe (m)", "hoehe_m", "zahl", erklaerung="Oberseite über dem Fußboden, für die Wärmeverteilung; leer = keine"),
            Spalte("Kategorie", "kategorie", "auswahl", pflicht=True, auswahl={v: k for k, v in KATEGORIEN.items()},
                   erklaerung="tabu = kein Modul darüber, Abstand = Mindestabstand zur Kante, neutral = nur Darstellung"),
            Spalte("Mindestabstand (cm)", "abstand_cm", "zahl", erklaerung="leer = Vorgabe fehlt"),
            Spalte("Passende Raumtypen", "raumtyp_ids", "raumtypen", erklaerung="Namen mit Komma getrennt; leer = alle Räume"),
            Spalte("Reihenfolge", "reihenfolge", "ganzzahl"),
            Spalte("Quelle", "quelle", pflicht=True, erklaerung=QUELLE),
            Spalte("aktiv", "aktiv", "janein", erklaerung="ja/nein – „nein“ blendet das Objekt in der Auswahl aus (nie gelöscht)"),
        ), ("name",), vorgaben=True,
    ),
    "bauteile": Bauteile(
        "bauteile", "U-Werte", (
            Spalte("Kategorie", "kategorie", pflicht=True, erklaerung="z. B. Außenwand; Teil des Schlüssels"),
            Spalte("Bezeichnung", "bezeichnung", pflicht=True, erklaerung="Teil des Schlüssels"),
            Spalte("Baualtersklasse", "baualtersklasse", erklaerung="Teil des Schlüssels, darf leer sein"),
            Spalte("U-Wert (W/(m²K))", "u_wert", "zahl", pflicht=True, erklaerung="0,01–10"),
            Spalte("Quelle", "quelle", pflicht=True, erklaerung=QUELLE),
            Spalte("Bemerkung", "bemerkung"),
        ), ("kategorie", "bezeichnung", "baualtersklasse"),
        hinweis="U-Werte werden über ihre ID verwendet (nicht je Projekt eingefroren); Änderungen wirken sofort auf die Kontrollrechnung.",
    ),
    "klimadaten": Klimadaten(
        "klimadaten", "Klimadaten", (
            Spalte("PLZ", "plz", erklaerung="Teil des Schlüssels, darf leer sein"),
            Spalte("Ort", "ort", pflicht=True, erklaerung="Teil des Schlüssels"),
            Spalte("Norm-Außentemperatur (°C)", "theta_e", "zahl", pflicht=True, erklaerung="nach DIN/TS 12831-1, −40 bis 10"),
            Spalte("Jahresmittel (°C)", "theta_m_e", "zahl", erklaerung="−10 bis 25"),
            Spalte("Quelle", "quelle", pflicht=True, erklaerung=QUELLE),
        ), ("plz", "ort"),
        hinweis="Klimadaten werden über ihre ID verwendet (nicht je Projekt eingefroren).",
    ),
}


# ── Export ──

def hinweisblatt(mappe: Workbook, titel: str, spalten: list[tuple[str, bool, str]], schluessel: str, hinweis: str = "") -> None:
    """Blatt „Hinweise“: Erklärung jeder Spalte (für alle Tabellen gleich aufgebaut)."""
    blatt = mappe.create_sheet("Hinweise")
    blatt.append([f"{titel} – Erklärung der Spalten"])
    blatt["A1"].font = Font(bold=True, size=13)
    blatt.append([f"Zuordnung beim Import über: {schluessel}. Fehlende Spalten bleiben unverändert; gelöscht wird über den Import nie."])
    if hinweis:
        blatt.append([hinweis])
    blatt.append(["Zahlen mit Komma oder Punkt; leere Zelle = Wert leeren (bei Pflichtfeldern ein Fehler)."])
    blatt.append([])
    blatt.append(["Spalte", "Pflicht", "Erklärung"])
    for zelle in blatt[blatt.max_row]:
        zelle.font = Font(bold=True)
    for kopf, pflicht, erklaerung in spalten:
        blatt.append([kopf, "ja" if pflicht else "", erklaerung])
    blatt.column_dimensions["A"].width = 42
    blatt.column_dimensions["B"].width = 9
    blatt.column_dimensions["C"].width = 90


def kopfzeile_formatieren(blatt) -> None:
    for zelle in blatt[1]:
        zelle.font = Font(bold=True, color="FFFFFF")
        zelle.fill = PatternFill("solid", fgColor="1F3A6E")
        zelle.alignment = Alignment(wrap_text=True, vertical="top")
    blatt.freeze_panes = "A2"


def exportieren(db: Session, t: Tabelle) -> tuple[bytes, str]:
    mappe = Workbook()
    blatt = mappe.active
    blatt.title = t.blatt
    blatt.append([s.kopf for s in t.spalten])
    namen = _raumtyp_namen(db)
    for z in t.zeilen(db):
        blatt.append([t.anzeige(s.feld, z.get(s.feld), db, namen) for s in t.spalten])
    kopfzeile_formatieren(blatt)
    for i, s in enumerate(t.spalten, start=1):
        blatt.column_dimensions[blatt.cell(1, i).column_letter].width = max(12, min(45, len(s.kopf) + 4))
    hinweisblatt(mappe, t.blatt, [(s.kopf, s.pflicht, s.erklaerung + (" (nur Information)" if s.nur_export else ""))
                                   for s in t.spalten],
                 ", ".join(t.nach_feld[f].kopf for f in t.schluessel), t.hinweis)
    puffer = io.BytesIO()
    mappe.save(puffer)
    return puffer.getvalue(), f"{t.blatt.replace(' ', '_')}_{date.today():%Y-%m-%d}.xlsx"


# ── Import ──

def pruefsumme(inhalt: bytes) -> str:
    return hashlib.sha256(inhalt).hexdigest()


def _zelle(s: Spalte, wert, namen_zu_id: dict[str, int], fehler: list[str]):
    if _leer(wert):
        return "" if s.art == "text" else [] if s.art == "raumtypen" else None
    if s.art == "roh":
        return wert.strip() if isinstance(wert, str) else wert
    if s.art == "text":
        if isinstance(wert, float) and wert.is_integer():
            wert = int(wert)  # z. B. PLZ als Zahl in Excel
        return str(wert).strip()
    if s.art == "janein":
        if isinstance(wert, bool):
            return wert
        text = str(wert).strip().lower()
        if text in ("ja", "nein"):
            return text == "ja"
        fehler.append(f"{s.kopf}: „{wert}“ statt ja/nein")
        return None
    if s.art == "auswahl":
        text = str(wert).strip()
        treffer = next((v for k, v in (s.auswahl or {}).items() if k.lower() == text.lower() or v == text), None)
        if treffer is None:
            fehler.append(f"{s.kopf}: „{text}“ – erlaubt: {', '.join(s.auswahl or {})}")
        return treffer
    if s.art == "raumtypen":
        ids = []
        for name in (n.strip() for n in str(wert).split(",")):
            if not name:
                continue
            if name not in namen_zu_id:
                fehler.append(f"{s.kopf}: Raumtyp „{name}“ unbekannt")
                continue
            ids.append(namen_zu_id[name])
        return sorted(set(ids))
    # zahl, ganzzahl
    if isinstance(wert, bool):
        fehler.append(f"{s.kopf}: „{wert}“ ist keine Zahl")
        return None
    if isinstance(wert, (int, float)):
        zahl = float(wert)
    else:
        try:
            zahl = float(str(wert).strip().replace(",", "."))
        except ValueError:
            fehler.append(f"{s.kopf}: „{wert}“ ist keine Zahl")
            return None
    if s.art == "ganzzahl":
        if not zahl.is_integer():
            fehler.append(f"{s.kopf}: „{wert}“ ist keine ganze Zahl")
            return None
        return int(zahl)
    return zahl


def vorschau(db: Session, t: Tabelle, inhalt: bytes) -> dict:
    """Prüft die Datei und ermittelt die Änderungen, ohne etwas zu speichern."""
    try:
        mappe = load_workbook(io.BytesIO(inhalt), data_only=True, read_only=True)
    except Exception:  # noqa: BLE001 – jede Lesestörung ist ein Fehler der Datei
        raise ImportAbgelehnt("Die Datei lässt sich nicht als Excel-Datei (.xlsx) lesen.") from None
    if t.blatt in mappe.sheetnames:
        blatt = mappe[t.blatt]
    else:
        blaetter = [b for b in mappe.worksheets if b.title != "Hinweise"]
        if not blaetter:
            raise ImportAbgelehnt(f"Blatt „{t.blatt}“ fehlt.")
        blatt = blaetter[0]
    zeilen = list(blatt.iter_rows(values_only=True))
    if not zeilen:
        raise ImportAbgelehnt("Die Datei ist leer.")
    kopf = [str(k).strip() if k is not None else "" for k in zeilen[0]]
    nach_kopf = {k: s for s in t.spalten if not s.nur_export for k in (s.kopf, *s.alias)}
    spalten = {i: nach_kopf[k] for i, k in enumerate(kopf) if k in nach_kopf}
    fehlend = [t.nach_feld[f].kopf for f in t.schluessel if f not in {s.feld for s in spalten.values()}]
    if fehlend:
        raise ImportAbgelehnt(f"Spalte „{', '.join(fehlend)}“ fehlt – bitte die exportierte Datei als Vorlage verwenden.")

    namen = _raumtyp_namen(db)
    namen_zu_id = {v: k for k, v in namen.items()}
    vorhanden = {t.schluessel_von(z): z for z in t.zeilen(db)}
    gesehen: dict[tuple, int] = {}
    neu, geaendert, aenderungen, fehler = [], [], [], []
    unveraendert = 0
    for nr, werte in enumerate(zeilen[1:], start=2):
        if all(_leer(v) for v in werte):
            continue
        zeilenfehler: list[str] = []
        daten = {s.feld: _zelle(s, werte[i] if i < len(werte) else None, namen_zu_id, zeilenfehler) for i, s in spalten.items()}
        schluessel = t.schluessel_von(daten)
        text = t.schluessel_text(schluessel)
        pflichtschluessel = [f for f in t.schluessel if t.nach_feld[f].pflicht]
        if any(_leer(daten.get(f)) for f in pflichtschluessel):
            fehler.append({"zeile": nr, "schluessel": text, "text": f"{' / '.join(t.nach_feld[f].kopf for f in pflichtschluessel)} fehlt"})
            continue
        if schluessel in gesehen:
            fehler.append({"zeile": nr, "schluessel": text, "text": f"„{text}“ doppelt (auch in Zeile {gesehen[schluessel]})"})
            continue
        gesehen[schluessel] = nr
        alt = vorhanden.get(schluessel)
        if alt is None and not t.neu_erlaubt:
            fehler.append({"zeile": nr, "schluessel": text, "text": f"„{text}“ gibt es nicht – neue Einträge sind hier nicht vorgesehen"})
            continue
        zusammen = {**(alt or {}), **daten}
        if not zeilenfehler:  # nach einem Umwandlungsfehler nicht zusätzlich „ist leer“ melden
            for s in t.spalten:
                if s.pflicht and not s.nur_export and _leer(zusammen.get(s.feld)):
                    zeilenfehler.append(f"{s.kopf} ist leer")
        if not zeilenfehler:
            zeilenfehler += t.pruefen(db, zusammen, alt)
        if zeilenfehler:
            fehler.append({"zeile": nr, "schluessel": text, "text": "; ".join(zeilenfehler)})
            continue
        if alt is None:
            neu.append({"zeile": nr, "schluessel": text, "daten": zusammen})
            continue
        liste = [
            {"zeile": nr, "schluessel": text, "feld": f, "feldname": t.nach_feld[f].kopf,
             "alt": t.anzeige(f, alt.get(f), db, namen), "neu": t.anzeige(f, zusammen.get(f), db, namen)}
            for f in {s.feld for s in spalten.values()} if not _gleich(alt.get(f), zusammen.get(f))
        ]
        liste.sort(key=lambda a: [s.feld for s in t.spalten].index(a["feld"]))
        if liste:
            geaendert.append({"zeile": nr, "schluessel": text, "daten": zusammen, "alt": alt})
            aenderungen.extend(liste)
        else:
            unveraendert += 1
    return {
        "neu": [n["schluessel"] for n in neu], "geaendert": [g["schluessel"] for g in geaendert], "unveraendert": unveraendert,
        "aenderungen": aenderungen, "fehler": fehler, "pruefsumme": pruefsumme(inhalt), "betroffen": [],
        "_neu": neu, "_geaendert": geaendert,
    }


def _anwenden(db: Session, t: Tabelle, v: dict) -> None:
    for g in v["_geaendert"]:
        t.schreiben(db, g["daten"], g["alt"])
    for n in v["_neu"]:
        t.schreiben(db, n["daten"], None)
    db.flush()


def auswirkung(db: Session, t: Tabelle, v: dict) -> list[dict]:
    """Welche offenen Projekte die Übernahme beträfe – probeweise angewendet und wieder verworfen."""
    if not t.vorgaben or not (v["_neu"] or v["_geaendert"]) or v["fehler"]:
        return []
    from app.vorgabenabgleich import _offene_projekte, projekt_kurz, vergleich
    from app.vorgabenstand import schnappschuss, unterschiede

    vorher = schnappschuss(db)
    sicherungspunkt = db.begin_nested()
    try:
        _anwenden(db, t, v)
        nachher = schnappschuss(db)
    finally:
        sicherungspunkt.rollback()
        db.expire_all()
    if not unterschiede(vorher, nachher):
        return []
    return [projekt_kurz(p, a) for p in _offene_projekte(db) if (a := vergleich(db, p, vorher, nachher)) is not None]


def uebernehmen(db: Session, t: Tabelle, inhalt: bytes, erwartete_pruefsumme: str) -> dict:
    """Übernimmt die geprüfte Datei (gleiche Prüfsumme, fehlerfrei); committet nicht."""
    if pruefsumme(inhalt) != erwartete_pruefsumme:
        raise ImportAbgelehnt("Die Datei wurde seit der Vorschau verändert – bitte erneut prüfen.")
    v = vorschau(db, t, inhalt)
    if v["fehler"]:
        raise ImportAbgelehnt(f"Die Datei enthält {len(v['fehler'])} Fehler – nichts übernommen.", v["fehler"])
    _anwenden(db, t, v)
    return {"neu": len(v["_neu"]), "geaendert": len(v["_geaendert"]), "unveraendert": v["unveraendert"]}
