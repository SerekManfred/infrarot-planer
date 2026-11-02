"""Daten für den Offline-Betrieb der PWA: Schnappschuss der Fachvorgaben und vollständiger Projektstand."""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.abhaengigkeiten import aktueller_benutzer
from app.db import get_db
from app.models import (
    Benutzer,
    Bauteilflaeche, BibBauteil, BibKlimadaten, BibModul, BibRaumtyp, Fachvorgaben, Geschoss, HeizlastPauschale,
    Objekt, Platzierungsregel, Projekt, Raum,
)
from app.projektzugriff import sichtbarkeit_pruefen
from app.routers.bibliotheken import ohne_preise
from app.routers.fachvorgaben import lesen as fachvorgaben_lesen
from app.schemas import OfflineVorgaben, ProjektPaket

router = APIRouter(prefix="/offline", tags=["Offline"], dependencies=[Depends(aktueller_benutzer)])


@router.get("/vorgaben", response_model=OfflineVorgaben)
def vorgaben(db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    # Stand = jüngste Änderung an Vorgaben oder Bibliotheken (zur Anzeige auf dem Gerät)
    zeiten = [
        z for m in (Fachvorgaben, BibRaumtyp, HeizlastPauschale, Platzierungsregel, BibBauteil, BibKlimadaten, BibModul)
        if (z := db.scalar(select(func.max(m.geaendert_am)))) is not None
    ]
    stand = max((z if z.tzinfo else z.replace(tzinfo=UTC) for z in zeiten), default=datetime.now(UTC))
    return OfflineVorgaben(
        stand=stand,
        fachvorgaben=fachvorgaben_lesen(db),
        bauteile=db.scalars(select(BibBauteil).order_by(BibBauteil.kategorie, BibBauteil.bezeichnung)).all(),
        klimadaten=db.scalars(select(BibKlimadaten).order_by(BibKlimadaten.plz, BibKlimadaten.ort)).all(),
        # Preise nur mit Recht „Kalkulation sehen“ (Paket M4c)
        module=[ohne_preise(m, benutzer) for m in db.scalars(select(BibModul).where(BibModul.aktiv).order_by(BibModul.leistung_w, BibModul.artikel_nr))],
    )


@router.get("/projekte/{projekt_id}", response_model=ProjektPaket)
def projekt(projekt_id: int, db: Session = Depends(get_db)):
    projekt = db.scalars(
        select(Projekt).where(Projekt.id == projekt_id).options(
            selectinload(Projekt.objekte).selectinload(Objekt.geschosse).selectinload(Geschoss.raeume)
            .selectinload(Raum.flaechen).selectinload(Bauteilflaeche.oeffnungen)
        )
    ).one_or_none()
    if projekt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projekt nicht gefunden – evtl. inzwischen gelöscht")
    sichtbarkeit_pruefen(db, projekt)  # Außendienst: nur eigene und zugewiesene Projekte
    return projekt
