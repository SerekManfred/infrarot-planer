"""Anmeldung, Abmeldung, Passwort ändern. Mit Bremse gegen wiederholte Fehlversuche."""
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer
from app.config import einstellungen
from app.db import get_db
from app.models import Anmeldeversuch, Benutzer
from app.schemas import Anmeldung, BenutzerLesen, PasswortAendern
from app.sicherheit import BLINDER_HASH, COOKIE_NAME, passwort_hashen, passwort_pruefen, token_erzeugen

router = APIRouter(prefix="/auth", tags=["Anmeldung"])

AUFBEWAHRUNG_VERSUCHE = timedelta(days=30)


def sitzung_setzen(antwort: Response, benutzer: Benutzer) -> None:
    antwort.set_cookie(
        COOKIE_NAME,
        token_erzeugen(benutzer.id, benutzer.sitzungs_version),
        max_age=einstellungen().sitzung_stunden * 3600,
        httponly=True,
        secure=einstellungen().cookie_secure,
        samesite="strict",
        path="/api",
    )


def _fehlversuche(db: Session, bedingung, seit: datetime) -> int:
    # Fehlversuche zählen erst ab der letzten erfolgreichen Anmeldung
    letzter_erfolg = db.scalar(
        select(func.max(Anmeldeversuch.zeitpunkt)).where(bedingung, Anmeldeversuch.erfolgreich.is_(True))
    )
    if letzter_erfolg is not None:
        if letzter_erfolg.tzinfo is None:
            letzter_erfolg = letzter_erfolg.replace(tzinfo=UTC)
        seit = max(seit, letzter_erfolg)
    return db.scalar(
        select(func.count()).where(bedingung, Anmeldeversuch.erfolgreich.is_(False), Anmeldeversuch.zeitpunkt > seit)
    )


@router.post("/anmelden", response_model=BenutzerLesen)
def anmelden(daten: Anmeldung, anfrage: Request, antwort: Response, db: Session = Depends(get_db)):
    e = einstellungen()
    jetzt = datetime.now(UTC)
    email = daten.email.strip().lower()
    ip = anfrage.client.host if anfrage.client else "unbekannt"
    seit = jetzt - timedelta(minutes=e.anmeldung_sperrminuten)

    if (
        _fehlversuche(db, Anmeldeversuch.email == email, seit) >= e.anmeldung_max_fehlversuche_konto
        or _fehlversuche(db, Anmeldeversuch.ip == ip, seit) >= e.anmeldung_max_fehlversuche_ip
    ):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Zu viele Fehlversuche. Bitte in {e.anmeldung_sperrminuten} Minuten erneut versuchen.",
        )

    benutzer = db.scalars(select(Benutzer).where(func.lower(Benutzer.email) == email)).first()
    gueltig = passwort_pruefen(benutzer.passwort_hash if benutzer else BLINDER_HASH, daten.passwort)
    erfolg = benutzer is not None and gueltig and benutzer.aktiv
    db.add(Anmeldeversuch(zeitpunkt=jetzt, email=email, ip=ip, erfolgreich=erfolg))
    db.execute(delete(Anmeldeversuch).where(Anmeldeversuch.zeitpunkt < jetzt - AUFBEWAHRUNG_VERSUCHE))
    db.commit()
    if not erfolg:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-Mail oder Passwort falsch")
    sitzung_setzen(antwort, benutzer)
    return benutzer


@router.post("/abmelden", status_code=status.HTTP_204_NO_CONTENT)
def abmelden(antwort: Response):
    antwort.delete_cookie(COOKIE_NAME, path="/api")


@router.get("/ich", response_model=BenutzerLesen)
def ich(benutzer: Benutzer = Depends(aktueller_benutzer)):
    return benutzer


@router.post("/passwort", status_code=status.HTTP_204_NO_CONTENT)
def passwort_aendern(
    daten: PasswortAendern, antwort: Response, db: Session = Depends(get_db),
    benutzer: Benutzer = Depends(aktueller_benutzer),
):
    if not passwort_pruefen(benutzer.passwort_hash, daten.altes_passwort):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bisheriges Passwort ist falsch")
    if daten.altes_passwort == daten.neues_passwort:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Neues Passwort muss sich vom bisherigen unterscheiden")
    benutzer.passwort_hash = passwort_hashen(daten.neues_passwort)
    # Andere Sitzungen (z. B. auf einem verlorenen Tablet) werden damit ungültig
    benutzer.sitzungs_version += 1
    db.commit()
    sitzung_setzen(antwort, benutzer)
