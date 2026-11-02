"""Firmendaten und Logo (Paket M3, 02.11.2026): lesen alle Angemeldeten (für die Berichtsfirma im Projekt und die
Berichte), pflegen nur Admins. Eine Firma ist Standard für Berichte; je Projekt kann eine andere gewählt werden.
Jede Änderung wird protokolliert (app/protokoll.py)."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404, rolle
from app.db import get_db
from app.logo import MAX_BYTES, LogoFehler, loeschen, pfad, speichern, verarbeiten
from app.models import Firma, Projekt
from app.schemas import FirmaAenderung, FirmaDaten, FirmaLesen

router = APIRouter(prefix="/firmen", tags=["Firmendaten"], dependencies=[Depends(aktueller_benutzer)])
nur_admin = rolle("admin")


def standardfirma(db: Session) -> Firma | None:
    return db.scalars(select(Firma).where(Firma.standard.is_(True))).first() or db.scalars(select(Firma).order_by(Firma.id)).first()


def berichtsfirma(db: Session, projekt: Projekt) -> Firma | None:
    """Firma für die Berichte eines Projekts: abweichend gewählte, sonst Standardfirma."""
    if projekt.berichtsfirma_id is not None:
        f = db.get(Firma, projekt.berichtsfirma_id)
        if f is not None:
            return f
    return standardfirma(db)


def _nur_eine_standard(db: Session, firma: Firma) -> None:
    if firma.standard:
        db.execute(update(Firma).where(Firma.id != firma.id).values(standard=False))


@router.get("", response_model=list[FirmaLesen])
def liste(db: Session = Depends(get_db)):
    return db.scalars(select(Firma).order_by(Firma.name)).all()


@router.post("", response_model=FirmaLesen, status_code=status.HTTP_201_CREATED, dependencies=[Depends(nur_admin)])
def anlegen(daten: FirmaDaten, db: Session = Depends(get_db)):
    firma = Firma(**daten.model_dump())
    db.add(firma)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"Die Firma „{daten.name}“ gibt es bereits") from None
    _nur_eine_standard(db, firma)
    db.commit()
    db.refresh(firma)
    return firma


@router.patch("/{firma_id}", response_model=FirmaLesen, dependencies=[Depends(nur_admin)])
def aendern(firma_id: int, daten: FirmaAenderung, db: Session = Depends(get_db)):
    firma = hole_oder_404(db, Firma, firma_id)
    werte = daten.model_dump(exclude_unset=True)
    if werte.get("standard") is False and firma.standard:
        raise HTTPException(status.HTTP_409_CONFLICT, "Eine Firma muss Standard bleiben – bitte eine andere als Standard festlegen.")
    for name, wert in werte.items():
        if wert is not None:
            setattr(firma, name, wert)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Diesen Firmennamen gibt es bereits") from None
    _nur_eine_standard(db, firma)
    db.commit()
    db.refresh(firma)
    return firma


@router.delete("/{firma_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(nur_admin)])
def entfernen(firma_id: int, db: Session = Depends(get_db)):
    firma = hole_oder_404(db, Firma, firma_id)
    if firma.standard:
        raise HTTPException(status.HTTP_409_CONFLICT, "Die Standardfirma kann nicht gelöscht werden.")
    datei = firma.logo_datei
    db.delete(firma)  # Projekte mit dieser Berichtsfirma fallen auf die Standardfirma zurück
    db.commit()
    loeschen(datei)


@router.post("/{firma_id}/logo", response_model=FirmaLesen, dependencies=[Depends(nur_admin)])
async def logo_hochladen(firma_id: int, datei: UploadFile, db: Session = Depends(get_db)):
    firma = hole_oder_404(db, Firma, firma_id)
    inhalt = await datei.read(MAX_BYTES + 1)
    try:
        daten, endung = verarbeiten(inhalt)
    except LogoFehler as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from None
    alt = firma.logo_datei
    firma.logo_datei = speichern(daten, endung)
    db.commit()
    loeschen(alt)
    db.refresh(firma)
    return firma


@router.delete("/{firma_id}/logo", response_model=FirmaLesen, dependencies=[Depends(nur_admin)])
def logo_loeschen(firma_id: int, db: Session = Depends(get_db)):
    firma = hole_oder_404(db, Firma, firma_id)
    alt, firma.logo_datei = firma.logo_datei, None
    db.commit()
    loeschen(alt)
    db.refresh(firma)
    return firma


@router.get("/{firma_id}/logo")
def logo(firma_id: int, db: Session = Depends(get_db)):
    firma = hole_oder_404(db, Firma, firma_id)
    if not firma.logo_datei:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kein Logo hinterlegt")
    datei = pfad(firma.logo_datei)
    if not datei.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Logo-Datei fehlt")
    art = "image/png" if datei.suffix == ".png" else "image/jpeg"
    return FileResponse(datei, media_type=art, headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache"})
