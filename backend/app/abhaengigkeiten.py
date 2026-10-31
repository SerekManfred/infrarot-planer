"""Gemeinsame FastAPI-Abhängigkeiten: angemeldeter Benutzer, Rollenprüfung, Laden per ID."""
from collections.abc import Callable
from typing import TypeVar

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.db import Base, get_db
from app.models import (
    Bauteilflaeche, Benutzer, Berechnung, BibBauteil, BibKlimadaten, BibModul, BibRaumtyp, Geschoss, Objekt, Oeffnung,
    Projekt, Raum,
)
from app.projektzugriff import NUR_EIGENE, nur_eigene, sichtbarkeit_pruefen
from app.sicherheit import COOKIE_NAME, token_lesen

M = TypeVar("M", bound=Base)

ROLLEN_TEXT = {"admin": "Admin", "fachpruefer": "Fachprüfer", "aussendienst": "Außendienst"}


def aktueller_benutzer(
    db: Session = Depends(get_db),
    sitzung: str | None = Cookie(default=None, alias=COOKIE_NAME),
    sperre: str | None = Header(default=None, alias="X-Sperre", max_length=100),
) -> Benutzer:
    inhalt = token_lesen(sitzung) if sitzung else None
    benutzer = db.get(Benutzer, inhalt[0]) if inhalt else None
    if benutzer is None or not benutzer.aktiv or benutzer.sitzungs_version != inhalt[1]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Nicht angemeldet")
    # Für das Änderungsprotokoll (app/protokoll.py)
    db.info["benutzer_id"] = benutzer.id
    # Sperr-Token eines Geräts, das ein Projekt offline bearbeitet (app/projektzugriff.py)
    db.info["sperre"] = sperre or None
    # Sichtbarkeit: nur Außendienst sieht nur eigene bzw. zugewiesene Projekte (app/projektzugriff.py)
    db.info[NUR_EIGENE] = benutzer.id if nur_eigene(benutzer) else None
    return benutzer


def rolle(*erlaubt: str) -> Callable[..., Benutzer]:
    def pruefen(benutzer: Benutzer = Depends(aktueller_benutzer)) -> Benutzer:
        if not benutzer.hat_rolle(*erlaubt):
            namen = " oder ".join(ROLLEN_TEXT[r] for r in erlaubt)
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Nur für {namen}")
        return benutzer

    return pruefen


nur_admin = rolle("admin")
nur_fachpruefer = rolle("fachpruefer")
vorgaben_pflege = rolle("fachpruefer", "admin")


# Verständliche Namen für „nicht gefunden“
BEZEICHNUNG = {
    Projekt: "Projekt", Objekt: "Gebäude", Geschoss: "Geschoss", Raum: "Raum", Bauteilflaeche: "Bauteilfläche",
    Oeffnung: "Fenster/Tür", Berechnung: "Berechnung", Benutzer: "Benutzer", BibRaumtyp: "Raumtyp",
    BibBauteil: "Bauteil", BibKlimadaten: "Klimadaten-Eintrag", BibModul: "Modul",
}
PROJEKTDATEN = (Projekt, Objekt, Geschoss, Raum, Bauteilflaeche, Oeffnung, Berechnung)


def hole_oder_404(db: Session, model: type[M], obj_id: int) -> M:
    """Lädt einen Datensatz; bei Projektdaten wird zugleich die Sichtbarkeit geprüft (fremd = nicht gefunden)."""
    obj = db.get(model, obj_id)
    name = BEZEICHNUNG.get(model, "Eintrag")
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{name} nicht gefunden – evtl. inzwischen gelöscht")
    if model in PROJEKTDATEN:
        sichtbarkeit_pruefen(db, obj)
    return obj
