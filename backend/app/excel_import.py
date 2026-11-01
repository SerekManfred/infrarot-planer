"""Import der geprüften Importdatei (Excel) des Auftraggebers: Raumtypen, Platzierungsregeln, Modulkatalog.

Aufbau der Datei: daten/IR-Planer_Importdaten_geprueft.xlsx (Blätter „Raumtypen“, „Platzierungsregeln“,
„Modulkatalog“; „Prüfprotokoll“ wird nur gelesen und angezeigt).

Grundsätze:
- Alles oder nichts: Bei einem Fehler wird nichts gespeichert.
- Nichts schätzen: Leere Zellen werden als leer übernommen („Vorgabe fehlt“, Preise fehlen).
- Raumtypen werden über die Bezeichnung zugeordnet. Abweichende Namen vorhandener Raumtypen lassen sich mit
  `umbenennen` (alt → neu) zuordnen, damit Projekte ihre Raumtypen behalten.
- Jede Änderung landet wie gewohnt im Protokoll (ohne Benutzer = Kommandozeile).
"""
import io
import re
from dataclasses import dataclass, field

from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BibModul, BibRaumtyp, Fachvorgaben, HeizlastPauschale, Platzierungsregel
from app.platzierungsregeln import HINWEIS_HOEHE_BEZEICHNUNG, IN_OBJEKTBIBLIOTHEK, NACH_BEZEICHNUNG, REGELN

KOPF_RAUMTYPEN = (
    "Raumtyp", "Neubau (W/m²)", "Effizienzhaus-Sanierung (W/m²)", "Altbau – Richtwert für Fachprüfer (W/m²)",
    "Raumtemperatur (°C)", "Luftwechsel (pro Stunde)", "Bemerkung", "Quelle des Werts",
)
KOPF_REGELN = ("Regel", "Wert", "Einheit", "Erläuterung / Gilt für", "Quelle des Werts")
KOPF_MODULE = (
    "Artikel-Nr.", "Bezeichnung", "Leistung (W)", "Länge (mm)", "Breite (mm)", "Bauhöhe (mm)", "Gewicht (kg)",
    "Schutzart (IP)", "Bad geeignet", "Oberfläche / Farbe", "EK netto (€)", "VK netto (€)", "Montagezeit (min)",
    "Quelle (Produktseite)", "Bemerkung",
)


class ImportFehler(Exception):
    def __init__(self, fehler: list[str]):
        super().__init__("\n".join(fehler))
        self.fehler = fehler


@dataclass
class Bericht:
    raumtypen_neu: list[str] = field(default_factory=list)
    raumtypen_aktualisiert: list[str] = field(default_factory=list)
    umbenannt: list[str] = field(default_factory=list)
    pauschalen: int = 0
    regeln: int = 0
    module_neu: int = 0
    module_aktualisiert: int = 0
    auffaelligkeiten: list[str] = field(default_factory=list)
    pruefprotokoll: list[str] = field(default_factory=list)

    def text(self) -> str:
        zeilen = [
            f"Raumtypen: {len(self.raumtypen_neu)} neu, {len(self.raumtypen_aktualisiert)} aktualisiert "
            f"({len(self.umbenannt)} davon umbenannt), {self.pauschalen} Pauschalen gesetzt",
            *(f"  umbenannt: {u}" for u in self.umbenannt),
            f"Platzierungsregeln: {self.regeln} gesetzt (plus Hinweis-Raumhöhe)",
            f"Modulkatalog: {self.module_neu} neu, {self.module_aktualisiert} aktualisiert",
            "Auffälligkeiten:",
            *(f"  - {a}" for a in self.auffaelligkeiten),
        ]
        if self.pruefprotokoll:
            zeilen += ["Prüfprotokoll der Datei:", *(f"  {p}" for p in self.pruefprotokoll)]
        return "\n".join(zeilen)


def _zeilen(blatt, kopf: tuple[str, ...], fehler: list[str]) -> list[dict]:
    zeilen = list(blatt.iter_rows(values_only=True))
    if not zeilen:
        fehler.append(f"Blatt „{blatt.title}“ ist leer")
        return []
    gelesen = tuple("" if v is None else str(v).strip() for v in zeilen[0][: len(kopf)])
    if gelesen != kopf:
        fehler.append(f"Blatt „{blatt.title}“: Kopfzeile {gelesen} statt {kopf}")
        return []
    ergebnis = []
    for nr, werte in enumerate(zeilen[1:], start=2):
        if all(v is None or str(v).strip() == "" for v in werte):
            continue
        zeile = {k: (None if v is None or (isinstance(v, str) and not v.strip()) else v) for k, v in zip(kopf, werte)}
        zeile["_zeile"] = nr
        ergebnis.append(zeile)
    return ergebnis


def _zahl(wert, ort: str, fehler: list[str], groesser_null: bool = False) -> float | None:
    if wert is None:
        return None
    try:
        zahl = float(str(wert).replace(",", ".")) if isinstance(wert, str) else float(wert)
    except ValueError:
        fehler.append(f"{ort}: „{wert}“ ist keine Zahl")
        return None
    if zahl < 0 or (groesser_null and zahl == 0):
        fehler.append(f"{ort}: {zahl} ist nicht zulässig")
    return zahl


def _text(wert) -> str:
    return "" if wert is None else str(wert).strip()


def schutzart_zahl(schutzart: str) -> int | None:
    """„IP44“ → 44; unbekannt → None."""
    treffer = re.fullmatch(r"IP\s*(\d{2})", schutzart.strip().upper())
    return int(treffer.group(1)) if treffer else None


def importiere_excel(db: Session, inhalt: bytes, umbenennen: dict[str, str] | None = None) -> Bericht:
    """Liest die Importdatei und schreibt in die Sitzung (ohne commit). Wirft ImportFehler mit allen Fehlern."""
    fehler: list[str] = []
    bericht = Bericht()
    try:
        mappe = load_workbook(io.BytesIO(inhalt), data_only=True, read_only=True)
    except Exception as e:  # noqa: BLE001 – jede Lesestörung ist ein Importfehler
        raise ImportFehler([f"Datei lässt sich nicht als Excel lesen: {e}"]) from None
    for name in ("Raumtypen", "Platzierungsregeln", "Modulkatalog"):
        if name not in mappe.sheetnames:
            fehler.append(f"Blatt „{name}“ fehlt")
    if fehler:
        raise ImportFehler(fehler)

    _raumtypen(db, _zeilen(mappe["Raumtypen"], KOPF_RAUMTYPEN, fehler), umbenennen or {}, bericht, fehler)
    _regeln(db, _zeilen(mappe["Platzierungsregeln"], KOPF_REGELN, fehler), bericht, fehler)
    _module(db, _zeilen(mappe["Modulkatalog"], KOPF_MODULE, fehler), bericht, fehler)
    if "Prüfprotokoll" in mappe.sheetnames:
        for werte in list(mappe["Prüfprotokoll"].iter_rows(values_only=True))[1:]:
            if any(werte):
                bericht.pruefprotokoll.append(" | ".join(_text(v) for v in werte if v is not None))
    if fehler:
        raise ImportFehler(fehler)
    db.flush()
    return bericht


def _raumtypen(db: Session, zeilen: list[dict], umbenennen: dict[str, str], bericht: Bericht, fehler: list[str]):
    vorhanden = {t.bezeichnung: t for t in db.scalars(select(BibRaumtyp))}
    namen_datei = {_text(z["Raumtyp"]) for z in zeilen}
    for alt, neu in umbenennen.items():
        if alt not in vorhanden:
            fehler.append(f"Umbenennen: Raumtyp „{alt}“ gibt es nicht")
        elif neu not in namen_datei:
            fehler.append(f"Umbenennen: „{neu}“ steht nicht im Blatt Raumtypen")
        elif neu in vorhanden:
            fehler.append(f"Umbenennen: Raumtyp „{neu}“ gibt es schon")
    if fehler:
        return
    for alt, neu in umbenennen.items():
        vorhanden[alt].bezeichnung = neu
        vorhanden[neu] = vorhanden.pop(alt)
        bericht.umbenannt.append(f"{alt} → {neu}")

    pauschalen = {(p.raumtyp_id, p.gebaeudestandard): p for p in db.scalars(select(HeizlastPauschale))}
    for reihenfolge, z in enumerate(zeilen):
        ort = f"Raumtypen, Zeile {z['_zeile']}"
        name = _text(z["Raumtyp"])
        quelle = _text(z["Quelle des Werts"])
        if not name:
            fehler.append(f"{ort}: Raumtyp fehlt")
            continue
        if not quelle:
            fehler.append(f"{ort}: Quelle des Werts fehlt")
        typ = vorhanden.get(name)
        if typ is None:
            typ = BibRaumtyp(bezeichnung=name)
            db.add(typ)
            vorhanden[name] = typ
            bericht.raumtypen_neu.append(name)
        else:
            bericht.raumtypen_aktualisiert.append(name)
        typ.theta_int = _zahl(z["Raumtemperatur (°C)"], ort, fehler)
        typ.luftwechsel = _zahl(z["Luftwechsel (pro Stunde)"], ort, fehler)
        typ.richtwert_altbau_w_m2 = _zahl(z["Altbau – Richtwert für Fachprüfer (W/m²)"], ort, fehler)
        typ.bemerkung = _text(z["Bemerkung"])
        typ.quelle = quelle
        typ.reihenfolge = reihenfolge
        db.flush()  # ID für die Pauschalen
        for spalte, standard in (("Neubau (W/m²)", "neubau"), ("Effizienzhaus-Sanierung (W/m²)", "effizienzhaus_sanierung")):
            w = _zahl(z[spalte], ort, fehler)
            eintrag = pauschalen.get((typ.id, standard))
            if w is None:
                if eintrag is not None:
                    bericht.auffaelligkeiten.append(f"{name} / {standard}: Pauschale {eintrag.w_m2:g} entfernt (Zelle leer)")
                    db.delete(eintrag)
                continue
            if eintrag is None:
                eintrag = HeizlastPauschale(raumtyp_id=typ.id, gebaeudestandard=standard)
                db.add(eintrag)
            elif eintrag.w_m2 != w:
                bericht.auffaelligkeiten.append(f"Pauschale {name} / {standard}: {eintrag.w_m2:g} → {w:g} W/m²")
            eintrag.w_m2, eintrag.quelle = w, quelle
            bericht.pauschalen += 1
    for name in sorted(set(vorhanden) - namen_datei):
        bericht.auffaelligkeiten.append(
            f"Raumtyp „{name}“ steht nicht in der Datei und bleibt unverändert (mit seinen bisherigen Werten)"
        )


def _regeln(db: Session, zeilen: list[dict], bericht: Bericht, fehler: list[str]):
    regeln = {r.schluessel: r for r in db.scalars(select(Platzierungsregel))}
    gesetzt: set[str] = set()
    for z in zeilen:
        ort = f"Platzierungsregeln, Zeile {z['_zeile']}"
        name, quelle = _text(z["Regel"]), _text(z["Quelle des Werts"])
        if not quelle:
            fehler.append(f"{ort}: Quelle des Werts fehlt")
        if name == HINWEIS_HOEHE_BEZEICHNUNG:
            hoehe = _zahl(z["Wert"], ort, fehler)
            vorgaben = db.get(Fachvorgaben, 1)
            if vorgaben is not None and vorgaben.hoehe_hinweis_m != hoehe:
                bericht.auffaelligkeiten.append(
                    f"Hinweis-Raumhöhe (Fachvorgaben): {vorgaben.hoehe_hinweis_m} → {hoehe} m"
                )
                vorgaben.hoehe_hinweis_m = hoehe
            continue
        if name in IN_OBJEKTBIBLIOTHEK:
            bericht.auffaelligkeiten.append(
                f"{ort}: „{name}“ steht seit 01.11.2026 in der Objektbibliothek – Zeile übersprungen"
            )
            continue
        definition = NACH_BEZEICHNUNG.get(name)
        if definition is None:
            fehler.append(f"{ort}: unbekannte Regel „{name}“")
            continue
        regel = regeln.get(definition.schluessel)
        if regel is None:
            regel = Platzierungsregel(schluessel=definition.schluessel, bezeichnung=definition.bezeichnung,
                                      einheit=definition.einheit)
            db.add(regel)
        wert = z["Wert"]
        if definition.art == "zahl":
            regel.wert, regel.wert_text = _zahl(wert, ort, fehler), ""
        elif definition.art == "janein":
            text = _text(wert).lower()
            if text not in ("ja", "nein", ""):
                fehler.append(f"{ort}: „{wert}“ statt ja/nein")
            regel.wert, regel.wert_text = None, text
        else:
            regel.wert, regel.wert_text = None, _text(wert)
        regel.erlaeuterung = _text(z["Erläuterung / Gilt für"])
        regel.quelle = quelle
        regel.reihenfolge = next(i for i, r in enumerate(REGELN) if r.schluessel == definition.schluessel)
        gesetzt.add(definition.schluessel)
        bericht.regeln += 1
    for definition in REGELN:
        if definition.schluessel not in gesetzt:
            bericht.auffaelligkeiten.append(
                f"Regel „{definition.bezeichnung}“ fehlt in der Datei → „Vorgabe fehlt“ (wird nicht geschätzt)"
            )


def _module(db: Session, zeilen: list[dict], bericht: Bericht, fehler: list[str]):
    vorhanden = {m.artikel_nr: m for m in db.scalars(select(BibModul))}
    in_datei: set[str] = set()
    ohne_preis = 0
    for z in zeilen:
        ort = f"Modulkatalog, Zeile {z['_zeile']}"
        nr = _text(z["Artikel-Nr."])
        if not nr:
            fehler.append(f"{ort}: Artikel-Nr. fehlt")
            continue
        if nr in in_datei:
            fehler.append(f"{ort}: Artikel-Nr. {nr} doppelt")
            continue
        in_datei.add(nr)
        quelle = _text(z["Quelle (Produktseite)"])
        if not quelle:
            fehler.append(f"{ort}: Quelle fehlt")
        bad = _text(z["Bad geeignet"]).lower()
        if bad not in ("ja", "nein"):
            fehler.append(f"{ort}: Bad geeignet „{z['Bad geeignet']}“ statt ja/nein")
        schutzart = _text(z["Schutzart (IP)"]).upper().replace(" ", "")
        ip = schutzart_zahl(schutzart)
        if ip is None:
            fehler.append(f"{ort}: Schutzart „{schutzart}“ nicht lesbar (erwartet z. B. IP44)")
        elif (bad == "ja") != (ip >= 44):
            bericht.auffaelligkeiten.append(f"Modul {nr}: Bad geeignet = {bad}, aber Schutzart {schutzart}")
        modul = vorhanden.get(nr)
        if modul is None:
            modul = BibModul(artikel_nr=nr)
            db.add(modul)
            bericht.module_neu += 1
        else:
            bericht.module_aktualisiert += 1
        modul.bezeichnung = _text(z["Bezeichnung"])
        modul.leistung_w = _zahl(z["Leistung (W)"], ort, fehler, groesser_null=True)
        modul.laenge_mm = _zahl(z["Länge (mm)"], ort, fehler, groesser_null=True)
        modul.breite_mm = _zahl(z["Breite (mm)"], ort, fehler, groesser_null=True)
        if modul.leistung_w is None or modul.laenge_mm is None or modul.breite_mm is None:
            fehler.append(f"{ort}: Leistung, Länge und Breite sind Pflicht")
        modul.bauhoehe_mm = _zahl(z["Bauhöhe (mm)"], ort, fehler)
        modul.gewicht_kg = _zahl(z["Gewicht (kg)"], ort, fehler)
        modul.schutzart = schutzart
        modul.bad_geeignet = bad == "ja"
        modul.oberflaeche = _text(z["Oberfläche / Farbe"])
        modul.ek_netto = _zahl(z["EK netto (€)"], ort, fehler)
        modul.vk_netto = _zahl(z["VK netto (€)"], ort, fehler)
        modul.montagezeit_min = _zahl(z["Montagezeit (min)"], ort, fehler)
        modul.quelle = quelle
        modul.bemerkung = _text(z["Bemerkung"])
        modul.aktiv = True
        if modul.ek_netto is None or modul.vk_netto is None or modul.montagezeit_min is None:
            ohne_preis += 1
    if ohne_preis:
        bericht.auffaelligkeiten.append(
            f"{ohne_preis} von {len(in_datei)} Modulen ohne EK/VK-Preis oder Montagezeit (bleiben leer, für Teil E nötig)"
        )
    for nr in sorted(set(vorhanden) - in_datei):
        if vorhanden[nr].aktiv:
            vorhanden[nr].aktiv = False
            bericht.auffaelligkeiten.append(f"Modul {nr} steht nicht mehr in der Datei → inaktiv (wird nicht mehr vorgeschlagen)")
