"""Heizlastberechnung je Objekt; jeder Lauf wird als neue Version gespeichert."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404
from app.berechnung import EingabeUnvollstaendig, heizlast_eingabe
from app.db import get_db
from app.models import Benutzer, Berechnung, Objekt
from app.rechenkern_bruecke import RechenkernFehler, berechne_heizlast
from app.schemas import BerechnungKurz, BerechnungLesen, BerechnungNeu

router = APIRouter(tags=["Berechnungen"], dependencies=[Depends(aktueller_benutzer)])


@router.get("/objekte/{objekt_id}/berechnungen", response_model=list[BerechnungKurz])
def auflisten(objekt_id: int, db: Session = Depends(get_db)):
    hole_oder_404(db, Objekt, objekt_id)
    return db.scalars(
        select(Berechnung).where(Berechnung.objekt_id == objekt_id).order_by(Berechnung.version.desc())
    ).all()


@router.post("/objekte/{objekt_id}/berechnungen", response_model=BerechnungLesen,
             status_code=status.HTTP_201_CREATED)
def berechnen(
    objekt_id: int, daten: BerechnungNeu, db: Session = Depends(get_db),
    benutzer: Benutzer = Depends(aktueller_benutzer),
):
    # Sperre auf das Objekt, damit parallele Läufe keine doppelte Versionsnummer bekommen
    objekt = db.scalars(select(Objekt).where(Objekt.id == objekt_id).with_for_update()).one_or_none()
    if objekt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Objekt {objekt_id} nicht gefunden")
    try:
        eingabe = heizlast_eingabe(objekt)
        ergebnis = berechne_heizlast(eingabe)
    except EingabeUnvollstaendig as fehler:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"meldung": "Eingaben unvollständig", "fehler": fehler.maengel}) from None
    except RechenkernFehler as fehler:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"meldung": "Rechenkern lehnt Eingabe ab", "fehler": [str(fehler)]}) from None
    version = (db.scalar(select(func.max(Berechnung.version)).where(Berechnung.objekt_id == objekt_id)) or 0) + 1
    berechnung = Berechnung(
        objekt_id=objekt_id, version=version, art="heizlast", rechenkern_version=ergebnis["rechenkern_version"],
        eingaben=eingabe, ergebnis=ergebnis, bemerkung=daten.bemerkung, erstellt_von_id=benutzer.id,
    )
    db.add(berechnung)
    db.commit()
    db.refresh(berechnung)
    return berechnung


@router.get("/berechnungen/{berechnung_id}", response_model=BerechnungLesen)
def lesen(berechnung_id: int, db: Session = Depends(get_db)):
    return hole_oder_404(db, Berechnung, berechnung_id)
