"""Gemeinsame FastAPI-Abhängigkeiten: angemeldeter Benutzer, Admin-Prüfung, Laden per ID."""
from typing import TypeVar

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import Base, get_db
from app.models import Benutzer
from app.sicherheit import COOKIE_NAME, token_lesen

M = TypeVar("M", bound=Base)


def aktueller_benutzer(
    db: Session = Depends(get_db),
    sitzung: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> Benutzer:
    benutzer_id = token_lesen(sitzung) if sitzung else None
    benutzer = db.get(Benutzer, benutzer_id) if benutzer_id else None
    if benutzer is None or not benutzer.aktiv:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Nicht angemeldet")
    return benutzer


def nur_admin(benutzer: Benutzer = Depends(aktueller_benutzer)) -> Benutzer:
    if benutzer.rolle != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Nur für Administratoren")
    return benutzer


def hole_oder_404(db: Session, model: type[M], obj_id: int) -> M:
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} {obj_id} nicht gefunden")
    return obj
