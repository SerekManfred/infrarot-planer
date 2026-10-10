"""Gemeinsame FastAPI-Abhängigkeiten: angemeldeter Benutzer, Rollenprüfung, Laden per ID."""
from collections.abc import Callable
from typing import TypeVar

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import Base, get_db
from app.models import Benutzer
from app.sicherheit import COOKIE_NAME, token_lesen

M = TypeVar("M", bound=Base)

ROLLEN_TEXT = {"admin": "Admin", "fachpruefer": "Fachprüfer", "aussendienst": "Außendienst"}


def aktueller_benutzer(
    db: Session = Depends(get_db),
    sitzung: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> Benutzer:
    inhalt = token_lesen(sitzung) if sitzung else None
    benutzer = db.get(Benutzer, inhalt[0]) if inhalt else None
    if benutzer is None or not benutzer.aktiv or benutzer.sitzungs_version != inhalt[1]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Nicht angemeldet")
    # Für das Änderungsprotokoll (app/protokoll.py)
    db.info["benutzer_id"] = benutzer.id
    return benutzer


def rolle(*erlaubt: str) -> Callable[..., Benutzer]:
    def pruefen(benutzer: Benutzer = Depends(aktueller_benutzer)) -> Benutzer:
        if benutzer.rolle not in erlaubt:
            namen = " oder ".join(ROLLEN_TEXT[r] for r in erlaubt)
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Nur für {namen}")
        return benutzer

    return pruefen


nur_admin = rolle("admin")
nur_fachpruefer = rolle("fachpruefer")
vorgaben_pflege = rolle("fachpruefer", "admin")


def hole_oder_404(db: Session, model: type[M], obj_id: int) -> M:
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} {obj_id} nicht gefunden")
    return obj
