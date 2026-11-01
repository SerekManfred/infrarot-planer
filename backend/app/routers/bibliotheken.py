"""Bibliotheken lesen (alle) und per CSV importieren (Fachprüfer und Admins). Raumtypen: siehe Fachvorgaben.

Modulkatalog (Festlegung 31.10.2026): lesen alle, pflegen Admin und Fachprüfer (anlegen, jedes Feld ändern,
deaktivieren; löschen nur, wenn in keinem Projekt verwendet). Jede Änderung wird je Feld protokolliert; danach werden
laufende Projekte mit verwendeten Modulen abgeglichen (app/modulabgleich.py). Export als Excel.
"""
import io
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile, status
from fastapi.exceptions import RequestValidationError
from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404, vorgaben_pflege
from app.csv_import import importiere
from app.db import get_db
from app.models import BibBauteil, BibKlimadaten, BibModul
from app.modulabgleich import abgleichen as module_abgleichen, verwendungen
from app.modul_import import ImportAbgelehnt, uebernehmen as katalog_uebernehmen, vorschau as katalog_vorschau
from app.schemas import (
    BauteilLesen, ImportBericht, KatalogImportErgebnis, KatalogImportVorschau, KlimadatenLesen, ModulAenderung, ModulLesen,
    ModulNeu,
)
from app.sicherung import SicherungFehler, datenbank_sichern
from app.tabellen_excel import hinweisblatt, kopfzeile_formatieren
from app.vorgabenabgleich import abgleichen

router = APIRouter(prefix="/bibliotheken", tags=["Bibliotheken"], dependencies=[Depends(aktueller_benutzer)])

MAX_CSV_BYTES = 5 * 1024 * 1024


@router.get("/bauteile", response_model=list[BauteilLesen])
def bauteile(db: Session = Depends(get_db)):
    return db.scalars(select(BibBauteil).order_by(BibBauteil.kategorie, BibBauteil.bezeichnung)).all()


@router.get("/klimadaten", response_model=list[KlimadatenLesen])
def klimadaten(plz: str | None = None, db: Session = Depends(get_db)):
    abfrage = select(BibKlimadaten).order_by(BibKlimadaten.plz, BibKlimadaten.ort)
    if plz:
        abfrage = abfrage.where(BibKlimadaten.plz == plz)
    return db.scalars(abfrage.limit(500)).all()


@router.get("/module", response_model=list[ModulLesen])
def module(db: Session = Depends(get_db)):
    """Modulkatalog (Deckenmodule), auch inaktive – die Oberfläche schlägt nur aktive vor."""
    return db.scalars(select(BibModul).order_by(BibModul.leistung_w, BibModul.artikel_nr)).all()


def _artikel_frei(db: Session, artikel_nr: str, ausser: int | None = None) -> None:
    vorhanden = db.scalar(select(BibModul.id).where(BibModul.artikel_nr == artikel_nr))
    if vorhanden is not None and vorhanden != ausser:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Artikel-Nr. {artikel_nr} ist bereits vergeben")


def _pruefen(daten: dict) -> ModulNeu:
    try:
        return ModulNeu.model_validate(daten)
    except ValidationError as fehler:  # verständlicher Text wie bei ungültigen Anfragen
        raise RequestValidationError(fehler.errors()) from None


@router.post("/module", response_model=ModulLesen, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(vorgaben_pflege)])
def modul_anlegen(daten: ModulNeu, db: Session = Depends(get_db)):
    _artikel_frei(db, daten.artikel_nr)
    modul = BibModul(**daten.model_dump())
    db.add(modul)
    db.commit()
    db.refresh(modul)
    return modul


@router.patch("/module/{modul_id}", response_model=ModulLesen, dependencies=[Depends(vorgaben_pflege)])
def modul_aendern(modul_id: int, daten: ModulAenderung, db: Session = Depends(get_db)):
    """Einzelne Felder ändern (geprüft wird der ganze Datensatz); danach laufende Projekte abgleichen."""
    modul = hole_oder_404(db, BibModul, modul_id)
    aenderung = daten.model_dump(exclude_unset=True)
    for feld in ("artikel_nr", "bezeichnung", "quelle", "leistung_w", "laenge_mm", "breite_mm", "schutzart", "bad_geeignet", "aktiv"):
        if feld in aenderung and aenderung[feld] is None:
            aenderung.pop(feld)  # Pflichtfelder lassen sich nicht leeren
    geprueft = _pruefen({**ModulLesen.model_validate(modul).model_dump(), **aenderung})
    if "artikel_nr" in aenderung:
        _artikel_frei(db, geprueft.artikel_nr, modul.id)
    for feld in aenderung:
        setattr(modul, feld, getattr(geprueft, feld))
    db.commit()
    module_abgleichen(db, db.info.get("benutzer_id"))
    db.refresh(modul)
    return modul


@router.delete("/module/{modul_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(vorgaben_pflege)])
def modul_loeschen(modul_id: int, db: Session = Depends(get_db)):
    """Nur unbenutzte Module löschen; verwendete deaktivieren (bestehende Planungen bleiben gültig)."""
    modul = hole_oder_404(db, BibModul, modul_id)
    anzahl = verwendungen(db, modul_id)
    if anzahl:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Modul {modul.artikel_nr} wird in {anzahl} Projekt{'' if anzahl == 1 else 'en'} verwendet und kann nicht gelöscht "
            "werden – bitte stattdessen deaktivieren (dann nicht mehr auswählbar, bestehende Planungen bleiben gültig).",
        )
    db.delete(modul)
    db.commit()


# Erklärung je Spalte für das Hinweisblatt (einheitlicher Aufbau aller Excel-Dateien, Paket L)
MODUL_ERKLAERUNG = {
    "artikel_nr": "eindeutig, Schlüssel für die Zuordnung", "leistung_w": "größer als 0", "laenge_mm": "größer als 0",
    "breite_mm": "größer als 0", "schutzart": "z. B. IP44", "bad_geeignet": "ja/nein – nur ab IP44",
    "quelle": "Pflicht, z. B. Link zur Produktseite", "ek_netto": "leer = fehlt (wird nicht geschätzt)",
    "vk_netto": "leer = fehlt", "montagezeit_min": "leer = fehlt",
    "oberflaechentemperatur_c": "nur Wärmeverteilung; leer = Vorgabewert",
    "emissionsgrad": "Verhältniszahl ohne Einheit, größer als 0 und höchstens 1 (typisch 0,90–0,95, Herstellerdatenblatt)",
    "abstrahlwinkel_grad": "voller Winkel, größer als 0 bis 180", "aktiv": "ja/nein – „nein“ deaktiviert (nie gelöscht)",
}
MODUL_PFLICHT = {"artikel_nr", "bezeichnung", "leistung_w", "laenge_mm", "breite_mm", "schutzart", "quelle"}

EXPORT_SPALTEN = (
    ("Artikel-Nr.", "artikel_nr"), ("Bezeichnung", "bezeichnung"), ("Leistung (W)", "leistung_w"),
    ("Länge (mm)", "laenge_mm"), ("Breite (mm)", "breite_mm"), ("Bauhöhe (mm)", "bauhoehe_mm"),
    ("Gewicht (kg)", "gewicht_kg"), ("Schutzart (IP)", "schutzart"), ("Bad geeignet", "bad_geeignet"),
    ("Oberfläche / Farbe", "oberflaeche"), ("EK netto (€)", "ek_netto"), ("VK netto (€)", "vk_netto"),
    ("Montagezeit (min)", "montagezeit_min"), ("Quelle (Produktseite)", "quelle"), ("Bemerkung", "bemerkung"),
    # nach den Spalten der Importdatei: Strahlerkennwerte für die Wärmeverteilung
    ("Oberflächentemperatur (°C)", "oberflaechentemperatur_c"), ("Emissionsgrad (0–1, ohne Einheit)", "emissionsgrad"),
    ("Abstrahlwinkel (°)", "abstrahlwinkel_grad"),
)


@router.get("/module/export.xlsx")
def module_export(db: Session = Depends(get_db)):
    """Modulkatalog als Excel – Blatt „Modulkatalog“ im Aufbau der Importdatei, dazu die Spalte „aktiv“."""
    mappe = Workbook()
    blatt = mappe.active
    blatt.title = "Modulkatalog"
    blatt.append([k for k, _ in EXPORT_SPALTEN] + ["aktiv"])
    for m in db.scalars(select(BibModul).order_by(BibModul.leistung_w, BibModul.artikel_nr)):
        werte = [getattr(m, f) for _, f in EXPORT_SPALTEN]
        werte[8] = "ja" if m.bad_geeignet else "nein"
        blatt.append(werte + ["ja" if m.aktiv else "nein"])
    for spalte, breite in zip("ABCDEFGHIJKLMNOPQRS", (12, 40, 12, 11, 11, 12, 12, 13, 12, 36, 12, 12, 16, 50, 40, 14, 12, 14, 8), strict=True):
        blatt.column_dimensions[spalte].width = breite
    kopfzeile_formatieren(blatt)
    hinweisblatt(mappe, "Modulkatalog", [(k, f in MODUL_PFLICHT, MODUL_ERKLAERUNG.get(f, "")) for k, f in (*EXPORT_SPALTEN, ("aktiv", "aktiv"))],
                 "Artikel-Nr.")
    puffer = io.BytesIO()
    mappe.save(puffer)
    return Response(
        puffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="Modulkatalog_{date.today():%Y-%m-%d}.xlsx"'},
    )


async def _excel_lesen(datei: UploadFile) -> bytes:
    inhalt = await datei.read(MAX_CSV_BYTES + 1)
    if len(inhalt) > MAX_CSV_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Die Datei ist größer als 5 MB")
    return inhalt


@router.post("/module/import/vorschau", response_model=KatalogImportVorschau, dependencies=[Depends(vorgaben_pflege)])
async def module_import_vorschau(datei: UploadFile, db: Session = Depends(get_db)):
    """Excel-Reimport, Schritt 1: prüfen und Änderungen zeigen – nichts wird gespeichert."""
    try:
        return katalog_vorschau(db, await _excel_lesen(datei))
    except ImportAbgelehnt as fehler:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(fehler)) from None


@router.post("/module/import", response_model=KatalogImportErgebnis, dependencies=[Depends(vorgaben_pflege)])
async def module_import(datei: UploadFile, pruefsumme: str = Form(...), db: Session = Depends(get_db)):
    """Excel-Reimport, Schritt 2: nach Bestätigung übernehmen – nur fehlerfrei, vorher Datenbanksicherung."""
    inhalt = await _excel_lesen(datei)
    try:
        katalog_vorschau(db, inhalt)  # vor der Sicherung prüfen: fehlerhafte Dateien brauchen keine Sicherung
        sicherung = datenbank_sichern("vor_katalogimport")
        ergebnis = katalog_uebernehmen(db, inhalt, pruefsumme)
    except ImportAbgelehnt as fehler:
        db.rollback()
        detail = str(fehler) + ("" if not fehler.fehler else " " + "; ".join(f"Zeile {f['zeile']}: {f['text']}" for f in fehler.fehler[:5]))
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail) from None
    except SicherungFehler as fehler:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"{fehler} – Import nicht durchgeführt.") from None
    db.commit()
    abgleich = module_abgleichen(db, db.info.get("benutzer_id"))
    return KatalogImportErgebnis(**ergebnis, sicherung=sicherung, projekte_warten=len(abgleich["betroffen"]))


@router.post("/{art}/import", response_model=ImportBericht, dependencies=[Depends(vorgaben_pflege)])
async def csv_importieren(
    art: Literal["bauteile", "raumtypen", "klimadaten"], datei: UploadFile, db: Session = Depends(get_db)
):
    inhalt = await datei.read(MAX_CSV_BYTES + 1)
    if len(inhalt) > MAX_CSV_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "CSV-Datei größer als 5 MB")
    try:
        text = inhalt.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "CSV-Datei muss UTF-8-kodiert sein") from None
    neu, aktualisiert, fehler = importiere(db, art, text)
    if fehler:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"meldung": "Nichts importiert", "fehler": fehler})
    if art == "raumtypen":  # Raumtypen gehören zu den Fachvorgaben der Projekte
        abgleichen(db, db.info.get("benutzer_id"))
    return ImportBericht(neu=neu, aktualisiert=aktualisiert, fehler=[])
