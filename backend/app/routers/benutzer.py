"""Benutzerverwaltung (nur Admin)."""
from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import nur_admin
from app.db import get_db
from app.models import Benutzer
from app.schemas import BenutzerLesen, BenutzerNeu
from app.sicherheit import passwort_hashen

router = APIRouter(prefix="/benutzer", tags=["Benutzer"], dependencies=[Depends(nur_admin)])


@router.get("", response_model=list[BenutzerLesen])
def auflisten(db: Session = Depends(get_db)):
    return db.scalars(select(Benutzer).order_by(Benutzer.name)).all()


@router.post("", response_model=BenutzerLesen, status_code=status.HTTP_201_CREATED)
def anlegen(daten: BenutzerNeu, db: Session = Depends(get_db)):
    benutzer = Benutzer(
        email=daten.email.strip().lower(), name=daten.name, rolle=daten.rolle,
        passwort_hash=passwort_hashen(daten.passwort),
    )
    db.add(benutzer)
    db.commit()
    return benutzer
