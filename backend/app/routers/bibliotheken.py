"""Bibliotheken lesen (alle) und per CSV importieren (nur Admin)."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer, nur_admin
from app.csv_import import importiere
from app.db import get_db
from app.models import BibBauteil, BibKlimadaten, BibRaumtyp
from app.schemas import BauteilLesen, ImportBericht, KlimadatenLesen, RaumtypLesen

router = APIRouter(prefix="/bibliotheken", tags=["Bibliotheken"], dependencies=[Depends(aktueller_benutzer)])

MAX_CSV_BYTES = 5 * 1024 * 1024


@router.get("/bauteile", response_model=list[BauteilLesen])
def bauteile(db: Session = Depends(get_db)):
    return db.scalars(select(BibBauteil).order_by(BibBauteil.kategorie, BibBauteil.bezeichnung)).all()


@router.get("/raumtypen", response_model=list[RaumtypLesen])
def raumtypen(db: Session = Depends(get_db)):
    return db.scalars(select(BibRaumtyp).order_by(BibRaumtyp.bezeichnung)).all()


@router.get("/klimadaten", response_model=list[KlimadatenLesen])
def klimadaten(plz: str | None = None, db: Session = Depends(get_db)):
    abfrage = select(BibKlimadaten).order_by(BibKlimadaten.plz, BibKlimadaten.ort)
    if plz:
        abfrage = abfrage.where(BibKlimadaten.plz == plz)
    return db.scalars(abfrage.limit(500)).all()


@router.post("/{art}/import", response_model=ImportBericht, dependencies=[Depends(nur_admin)])
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
