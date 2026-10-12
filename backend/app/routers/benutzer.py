"""Benutzerverwaltung (nur Admin): anlegen, Name/Rollen ändern, deaktivieren, Passwort neu setzen.

Rollen sind kombinierbar (z. B. Admin und Fachprüfer). Es bleibt immer mindestens ein aktiver Admin.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import hole_oder_404, nur_admin
from app.db import get_db
from app.models import Benutzer
from app.schemas import BenutzerAenderung, BenutzerLesen, BenutzerNeu, PasswortSetzen
from app.sicherheit import passwort_hashen

router = APIRouter(prefix="/benutzer", tags=["Benutzer"])


@router.get("", response_model=list[BenutzerLesen], dependencies=[Depends(nur_admin)])
def auflisten(db: Session = Depends(get_db)):
    return db.scalars(select(Benutzer).order_by(Benutzer.aktiv.desc(), Benutzer.name)).all()


@router.post("", response_model=BenutzerLesen, status_code=status.HTTP_201_CREATED, dependencies=[Depends(nur_admin)])
def anlegen(daten: BenutzerNeu, db: Session = Depends(get_db)):
    benutzer = Benutzer(
        email=daten.email.strip().lower(), name=daten.name, rollen=daten.rollen,
        passwort_hash=passwort_hashen(daten.passwort),
    )
    db.add(benutzer)
    db.commit()
    return benutzer


@router.patch("/{benutzer_id}", response_model=BenutzerLesen)
def aendern(
    benutzer_id: int, daten: BenutzerAenderung, db: Session = Depends(get_db), admin: Benutzer = Depends(nur_admin)
):
    benutzer = hole_oder_404(db, Benutzer, benutzer_id)
    aenderung = daten.model_dump(exclude_unset=True, exclude_none=True)
    if benutzer.id == admin.id and (aenderung.get("aktiv") is False or "admin" not in aenderung.get("rollen", ["admin"])):
        raise HTTPException(status.HTTP_409_CONFLICT, "Das eigene Konto kann nicht deaktiviert oder herabgestuft werden")
    for name, wert in aenderung.items():
        setattr(benutzer, name, wert)
    if aenderung.get("aktiv") is False:
        benutzer.sitzungs_version += 1
    db.flush()
    aktive_admins = sum(b.hat_rolle("admin") for b in db.scalars(select(Benutzer).where(Benutzer.aktiv.is_(True))))
    if aktive_admins == 0:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Es muss mindestens ein aktiver Admin bleiben")
    db.commit()
    return benutzer


@router.post("/{benutzer_id}/passwort", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(nur_admin)])
def passwort_setzen(benutzer_id: int, daten: PasswortSetzen, db: Session = Depends(get_db)):
    benutzer = hole_oder_404(db, Benutzer, benutzer_id)
    benutzer.passwort_hash = passwort_hashen(daten.neues_passwort)
    benutzer.sitzungs_version += 1
    db.commit()
