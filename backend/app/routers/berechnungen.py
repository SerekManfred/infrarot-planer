"""Auswertung je Objekt (live) und gespeicherte, versionierte Berechnungen."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404
from app.projektzugriff import sichtbarkeit_pruefen
from app.auswertung import objekt_auswerten
from app.db import get_db
from app.models import Benutzer, Berechnung, Objekt
from app.schemas import BerechnungKurz, BerechnungLesen, BerechnungNeu

router = APIRouter(tags=["Berechnungen"], dependencies=[Depends(aktueller_benutzer)])


@router.get("/objekte/{objekt_id}/auswertung")
def auswertung(objekt_id: int, db: Session = Depends(get_db)) -> dict:
    """Aktuelle Auswertung aller Räume (nicht gespeichert)."""
    return objekt_auswerten(db, hole_oder_404(db, Objekt, objekt_id))[1]


@router.get("/objekte/{objekt_id}/berechnungen", response_model=list[BerechnungKurz])
def auflisten(objekt_id: int, db: Session = Depends(get_db)):
    hole_oder_404(db, Objekt, objekt_id)
    return db.scalars(
        select(Berechnung).where(Berechnung.objekt_id == objekt_id).order_by(Berechnung.version.desc())
    ).all()


@router.post("/objekte/{objekt_id}/berechnungen", response_model=BerechnungLesen,
             status_code=status.HTTP_201_CREATED)
def speichern(
    objekt_id: int, daten: BerechnungNeu, db: Session = Depends(get_db),
    benutzer: Benutzer = Depends(aktueller_benutzer),
):
    """Speichert die aktuelle Auswertung als neue Version."""
    # Sperre auf das Objekt, damit parallele Läufe keine doppelte Versionsnummer bekommen
    objekt = db.scalars(select(Objekt).where(Objekt.id == objekt_id).with_for_update()).one_or_none()
    if objekt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gebäude nicht gefunden – evtl. inzwischen gelöscht")
    sichtbarkeit_pruefen(db, objekt)
    eingabe, ergebnis = objekt_auswerten(db, objekt)
    version = (db.scalar(select(func.max(Berechnung.version)).where(Berechnung.objekt_id == objekt_id)) or 0) + 1
    berechnung = Berechnung(
        objekt_id=objekt_id, version=version, art="auswertung", rechenkern_version=ergebnis["rechenkern_version"],
        eingaben=eingabe, ergebnis=ergebnis, bemerkung=daten.bemerkung, erstellt_von_id=benutzer.id,
    )
    db.add(berechnung)
    db.commit()
    db.refresh(berechnung)
    return berechnung


@router.get("/berechnungen/{berechnung_id}", response_model=BerechnungLesen)
def lesen(berechnung_id: int, db: Session = Depends(get_db)):
    return hole_oder_404(db, Berechnung, berechnung_id)
