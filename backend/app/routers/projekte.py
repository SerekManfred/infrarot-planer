"""Projekte. Alle angemeldeten Benutzer sehen und bearbeiten alle Projekte; löschen darf nur ein Admin."""
from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404, nur_admin
from app.db import get_db
from app.models import Benutzer, Projekt
from app.schemas import ProjektAenderung, ProjektLesen, ProjektNeu

router = APIRouter(prefix="/projekte", tags=["Projekte"], dependencies=[Depends(aktueller_benutzer)])


@router.get("", response_model=list[ProjektLesen])
def auflisten(db: Session = Depends(get_db)):
    return db.scalars(select(Projekt).order_by(Projekt.geaendert_am.desc(), Projekt.id.desc())).all()


@router.post("", response_model=ProjektLesen, status_code=status.HTTP_201_CREATED)
def anlegen(daten: ProjektNeu, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    projekt = Projekt(**daten.model_dump(), ersteller_id=benutzer.id)
    db.add(projekt)
    db.commit()
    db.refresh(projekt)
    return projekt


@router.get("/{projekt_id}", response_model=ProjektLesen)
def lesen(projekt_id: int, db: Session = Depends(get_db)):
    return hole_oder_404(db, Projekt, projekt_id)


@router.patch("/{projekt_id}", response_model=ProjektLesen)
def aendern(projekt_id: int, daten: ProjektAenderung, db: Session = Depends(get_db)):
    projekt = hole_oder_404(db, Projekt, projekt_id)
    for name, wert in daten.model_dump(exclude_unset=True).items():
        setattr(projekt, name, wert)
    db.commit()
    db.refresh(projekt)
    return projekt


@router.delete("/{projekt_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(nur_admin)])
def loeschen(projekt_id: int, db: Session = Depends(get_db)):
    db.delete(hole_oder_404(db, Projekt, projekt_id))
    db.commit()
