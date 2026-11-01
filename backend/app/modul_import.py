"""Reimport des exportierten Modulkatalogs aus Excel (Festlegung Auftraggeber 02.11.2026).

- Gleiche Spalten wie der Export (GET /bibliotheken/module/export.xlsx); fehlende Spalten bleiben unverändert.
- Zuordnung über die Artikel-Nr.; neue Artikel-Nr. = neues Modul. Über den Import wird nie gelöscht – höchstens per
  Spalte „aktiv“ = nein deaktiviert.
- Erst Vorschau (geändert / neu / unverändert, Änderungen Feld alt → neu, Fehler mit Zeilennummer), Übernahme nur
  fehlerfrei und nur für genau die geprüfte Datei (Prüfsumme). Vor der Übernahme wird die Datenbank gesichert.
- Jede Änderung wird je Feld protokolliert; verwendete Module in Projekten werden wie bei Einzeländerungen abgeglichen.
"""
import hashlib
import io

from openpyxl import load_workbook
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.fehlertexte import eingabefehler_text
from app.models import BibModul
from app.schemas import ModulLesen, ModulNeu

# Spaltenkopf im Export → Feld (Reihenfolge wie im Export)
SPALTEN: dict[str, str] = {
    "Artikel-Nr.": "artikel_nr", "Bezeichnung": "bezeichnung", "Leistung (W)": "leistung_w", "Länge (mm)": "laenge_mm",
    "Breite (mm)": "breite_mm", "Bauhöhe (mm)": "bauhoehe_mm", "Gewicht (kg)": "gewicht_kg", "Schutzart (IP)": "schutzart",
    "Bad geeignet": "bad_geeignet", "Oberfläche / Farbe": "oberflaeche", "EK netto (€)": "ek_netto", "VK netto (€)": "vk_netto",
    "Montagezeit (min)": "montagezeit_min", "Quelle (Produktseite)": "quelle", "Bemerkung": "bemerkung",
    "Oberflächentemperatur (°C)": "oberflaechentemperatur_c", "Emissionsgrad (0–1, ohne Einheit)": "emissionsgrad",
    "Abstrahlwinkel (°)": "abstrahlwinkel_grad", "aktiv": "aktiv",
}
FELDNAME = {feld: kopf for kopf, feld in SPALTEN.items()}
# frühere Überschriften (Export bis 01.11.2026) werden weiter erkannt
SPALTEN["Emissionsgrad"] = "emissionsgrad"
JA_NEIN = ("bad_geeignet", "aktiv")
TEXT = ("artikel_nr", "bezeichnung", "schutzart", "oberflaeche", "quelle", "bemerkung")


class ImportAbgelehnt(Exception):
    def __init__(self, meldung: str, fehler: list[dict] | None = None):
        super().__init__(meldung)
        self.fehler = fehler or []


def pruefsumme(inhalt: bytes) -> str:
    return hashlib.sha256(inhalt).hexdigest()


def _gleich(a, b) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        return abs(float(a) - float(b)) < 1e-9
    return (a or None) == (b or None) if isinstance(a, str) or isinstance(b, str) else a == b


def _zelle(feld: str, wert, fehler: list[str]):
    """Zellwert in den Feldtyp umwandeln; leer → None."""
    if wert is None or (isinstance(wert, str) and not wert.strip()):
        return "" if feld in ("oberflaeche", "bemerkung") else None
    if feld in JA_NEIN:
        if isinstance(wert, bool):
            return wert
        text = str(wert).strip().lower()
        if text in ("ja", "nein"):
            return text == "ja"
        fehler.append(f"{FELDNAME[feld]}: „{wert}“ statt ja/nein")
        return None
    if feld in TEXT:
        text = str(wert).strip()
        return text.upper().replace(" ", "") if feld == "schutzart" else text
    if isinstance(wert, (int, float)):
        return float(wert)
    try:
        return float(str(wert).strip().replace(",", "."))
    except ValueError:
        fehler.append(f"{FELDNAME[feld]}: „{wert}“ ist keine Zahl")
        return None


def _gruende(fehler: ValidationError) -> str:
    return eingabefehler_text(fehler.errors()).removeprefix("Bitte Eingaben prüfen: ").removesuffix(".")


def vorschau(db: Session, inhalt: bytes) -> dict:
    """Prüft die Datei und ermittelt die Änderungen, ohne etwas zu speichern."""
    try:
        mappe = load_workbook(io.BytesIO(inhalt), data_only=True, read_only=True)
    except Exception:  # noqa: BLE001 – jede Lesestörung ist ein Fehler der Datei
        raise ImportAbgelehnt("Die Datei lässt sich nicht als Excel-Datei (.xlsx) lesen.") from None
    blatt = mappe["Modulkatalog"] if "Modulkatalog" in mappe.sheetnames else mappe.worksheets[0]
    zeilen = list(blatt.iter_rows(values_only=True))
    if not zeilen:
        raise ImportAbgelehnt("Die Datei ist leer.")
    kopf = [str(k).strip() if k is not None else "" for k in zeilen[0]]
    spalten = {i: SPALTEN[k] for i, k in enumerate(kopf) if k in SPALTEN}
    if "artikel_nr" not in spalten.values():
        raise ImportAbgelehnt("Spalte „Artikel-Nr.“ fehlt – bitte den exportierten Katalog als Vorlage verwenden.")

    vorhanden = {m.artikel_nr: m for m in db.scalars(select(BibModul))}
    gesehen: dict[str, int] = {}
    neu: list[dict] = []
    geaendert: list[dict] = []
    aenderungen: list[dict] = []
    fehler: list[dict] = []
    unveraendert = 0
    for nr, werte in enumerate(zeilen[1:], start=2):
        if all(v is None or (isinstance(v, str) and not v.strip()) for v in werte):
            continue
        zeilenfehler: list[str] = []
        daten = {feld: _zelle(feld, werte[i] if i < len(werte) else None, zeilenfehler) for i, feld in spalten.items()}
        artikel = daten.get("artikel_nr")
        if not artikel:
            fehler.append({"zeile": nr, "artikel_nr": "", "text": "Artikel-Nr. fehlt"})
            continue
        if artikel in gesehen:
            fehler.append({"zeile": nr, "artikel_nr": artikel, "text": f"Artikel-Nr. {artikel} doppelt (auch in Zeile {gesehen[artikel]})"})
            continue
        gesehen[artikel] = nr
        modul = vorhanden.get(artikel)
        basis = ModulLesen.model_validate(modul).model_dump() if modul else {"aktiv": True}
        if modul is None:
            # leere Pflichtfelder eines neuen Moduls nicht als „leer gesetzt“, sondern als fehlend melden
            daten = {k: v for k, v in daten.items() if v is not None}
        else:
            # leere Pflichtfelder bei vorhandenen Modulen: Fehler statt still beibehalten
            for feld in ("bezeichnung", "leistung_w", "laenge_mm", "breite_mm", "schutzart", "quelle", "bad_geeignet", "aktiv"):
                if feld in daten and daten[feld] is None:
                    zeilenfehler.append(f"{FELDNAME[feld]} ist leer")
        if zeilenfehler:
            fehler.append({"zeile": nr, "artikel_nr": artikel, "text": "; ".join(zeilenfehler)})
            continue
        try:
            geprueft = ModulNeu.model_validate({**basis, **{k: v for k, v in daten.items() if v is not None or k not in ("bad_geeignet", "aktiv")}})
        except ValidationError as e:
            fehler.append({"zeile": nr, "artikel_nr": artikel, "text": _gruende(e)})
            continue
        if modul is None:
            neu.append({"zeile": nr, "artikel_nr": artikel, "daten": geprueft.model_dump()})
            continue
        liste = [
            {"zeile": nr, "artikel_nr": artikel, "feld": feld, "feldname": FELDNAME[feld], "alt": basis.get(feld),
             "neu": getattr(geprueft, feld)}
            for feld in daten if not _gleich(basis.get(feld), getattr(geprueft, feld))
        ]
        if liste:
            geaendert.append({"zeile": nr, "artikel_nr": artikel, "felder": {a["feld"]: a["neu"] for a in liste}})
            aenderungen.extend(liste)
        else:
            unveraendert += 1
    return {
        "neu": [n["artikel_nr"] for n in neu], "geaendert": [g["artikel_nr"] for g in geaendert], "unveraendert": unveraendert,
        "aenderungen": aenderungen, "fehler": fehler, "pruefsumme": pruefsumme(inhalt),
        "_neu": neu, "_geaendert": geaendert,
    }


def uebernehmen(db: Session, inhalt: bytes, erwartete_pruefsumme: str) -> dict:
    """Übernimmt die geprüfte Datei (gleiche Prüfsumme, fehlerfrei); committet nicht."""
    if pruefsumme(inhalt) != erwartete_pruefsumme:
        raise ImportAbgelehnt("Die Datei wurde seit der Vorschau verändert – bitte erneut prüfen.")
    v = vorschau(db, inhalt)
    if v["fehler"]:
        raise ImportAbgelehnt(f"Die Datei enthält {len(v['fehler'])} Fehler – nichts übernommen.", v["fehler"])
    vorhanden = {m.artikel_nr: m for m in db.scalars(select(BibModul))}
    for g in v["_geaendert"]:
        modul = vorhanden[g["artikel_nr"]]
        for feld, wert in g["felder"].items():
            setattr(modul, feld, wert)  # je Feld protokolliert (app/protokoll.py)
    for n in v["_neu"]:
        db.add(BibModul(**n["daten"]))
    return {"neu": len(v["_neu"]), "geaendert": len(v["_geaendert"]), "unveraendert": v["unveraendert"]}
