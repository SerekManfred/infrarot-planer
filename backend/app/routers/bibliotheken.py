"""Bibliotheken lesen (alle) und per CSV importieren (Fachprüfer und Admins). Raumtypen: siehe Fachvorgaben."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer, vorgaben_pflege
from app.csv_import import importiere
from app.db import get_db
from app.models import BibBauteil, BibKlimadaten, BibModul
from app.schemas import BauteilLesen, ImportBericht, KlimadatenLesen, ModulLesen

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
    return ImportBericht(neu=neu, aktualisiert=aktualisiert, fehler=[])
