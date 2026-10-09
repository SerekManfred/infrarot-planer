"""Anmeldung und Abmeldung."""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer
from app.config import einstellungen
from app.db import get_db
from app.models import Benutzer
from app.schemas import Anmeldung, BenutzerLesen
from app.sicherheit import BLINDER_HASH, COOKIE_NAME, passwort_pruefen, token_erzeugen

router = APIRouter(prefix="/auth", tags=["Anmeldung"])


@router.post("/anmelden", response_model=BenutzerLesen)
def anmelden(daten: Anmeldung, antwort: Response, db: Session = Depends(get_db)):
    benutzer = db.scalars(select(Benutzer).where(func.lower(Benutzer.email) == daten.email.strip().lower())).first()
    gueltig = passwort_pruefen(benutzer.passwort_hash if benutzer else BLINDER_HASH, daten.passwort)
    if benutzer is None or not gueltig or not benutzer.aktiv:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-Mail oder Passwort falsch")
    antwort.set_cookie(
        COOKIE_NAME,
        token_erzeugen(benutzer.id),
        max_age=einstellungen().sitzung_stunden * 3600,
        httponly=True,
        secure=einstellungen().cookie_secure,
        samesite="strict",
        path="/api",
    )
    return benutzer


@router.post("/abmelden", status_code=status.HTTP_204_NO_CONTENT)
def abmelden(antwort: Response):
    antwort.delete_cookie(COOKIE_NAME, path="/api")


@router.get("/ich", response_model=BenutzerLesen)
def ich(benutzer: Benutzer = Depends(aktueller_benutzer)):
    return benutzer
