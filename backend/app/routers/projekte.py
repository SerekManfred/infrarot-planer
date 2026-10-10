"""Projekte, Projektstatus und Änderungsprotokoll.

Alle angemeldeten Benutzer sehen und bearbeiten alle Projekte. Den Status ändern nur Fachprüfer;
löschen dürfen nur Admins. Freigegebene Projekte sind gesperrt (app/projektzugriff.py).
Zur Offline-Bearbeitung checkt ein Gerät ein Projekt aus; solange ist es für alle anderen gesperrt.
Einchecken kann das Gerät selbst; ein Admin kann die Sperre lösen.
"""
import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404, nur_admin, nur_fachpruefer
from app.auswertung import objekt_auswerten
from app.db import get_db
from app.models import Benutzer, Berechnung, Objekt, Projekt, Protokoll
from app.projektzugriff import bearbeitung_pruefen, haelt_sperre, sperre_hash, sperre_pruefen
from app.schemas import (
    Auschecken, AuscheckenAntwort, ProjektAenderung, ProjektDetail, ProjektLesen, ProjektNeu, ProtokollLesen,
    StatusAenderung,
)

router = APIRouter(prefix="/projekte", tags=["Projekte"], dependencies=[Depends(aktueller_benutzer)])

# Erlaubte Statuswechsel (nur Fachprüfer)
UEBERGAENGE = {
    ("entwurf", "geprueft"),
    ("geprueft", "freigegeben"),
    ("geprueft", "entwurf"),
    ("freigegeben", "entwurf"),
}


@router.get("", response_model=list[ProjektLesen])
def auflisten(db: Session = Depends(get_db)):
    return db.scalars(select(Projekt).order_by(Projekt.geaendert_am.desc(), Projekt.id.desc())).all()


@router.post("", response_model=ProjektDetail, status_code=status.HTTP_201_CREATED)
def anlegen(daten: ProjektNeu, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    werte = daten.model_dump()
    gebaeude = {k: werte.pop(k) for k in ("gebaeudestandard", "strasse", "plz", "ort")}
    projekt = Projekt(**werte, ersteller_id=benutzer.id)
    projekt.objekte.append(Objekt(bezeichnung="Gebäude", **gebaeude))
    db.add(projekt)
    db.commit()
    return lesen(projekt.id, db)


@router.get("/{projekt_id}", response_model=ProjektDetail)
def lesen(projekt_id: int, db: Session = Depends(get_db)):
    projekt = db.scalars(
        select(Projekt).where(Projekt.id == projekt_id).options(selectinload(Projekt.objekte))
    ).one_or_none()
    if projekt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Projekt {projekt_id} nicht gefunden")
    db.refresh(projekt)
    return projekt


@router.patch("/{projekt_id}", response_model=ProjektLesen)
def aendern(projekt_id: int, daten: ProjektAenderung, db: Session = Depends(get_db)):
    projekt = hole_oder_404(db, Projekt, projekt_id)
    bearbeitung_pruefen(db, projekt)
    for name, wert in daten.model_dump(exclude_unset=True).items():
        setattr(projekt, name, wert)
    db.commit()
    db.refresh(projekt)
    return projekt


@router.post("/{projekt_id}/status", response_model=ProjektLesen)
def status_aendern(
    projekt_id: int, daten: StatusAenderung, db: Session = Depends(get_db),
    pruefer: Benutzer = Depends(nur_fachpruefer),
):
    projekt = hole_oder_404(db, Projekt, projekt_id)
    sperre_pruefen(db, projekt)
    if (projekt.status, daten.status) not in UEBERGAENGE:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Statuswechsel {projekt.status} → {daten.status} nicht erlaubt")
    jetzt = datetime.now(UTC)
    # Ohne Zwischenspeichern, damit der Statuswechsel als ein Protokolleintrag erscheint
    with db.no_autoflush:
        if daten.status == "geprueft":
            projekt.geprueft_von_id, projekt.geprueft_am = pruefer.id, jetzt
        elif daten.status == "freigegeben":
            projekt.freigegeben_von_id, projekt.freigegeben_am = pruefer.id, jetzt
            # Auswertung einfrieren, damit spätere Vorgabenänderungen das freigegebene Ergebnis nicht verändern
            for objekt in projekt.objekte:
                eingabe, auswertung = objekt_auswerten(db, objekt)
                version = (db.scalar(
                    select(func.max(Berechnung.version)).where(Berechnung.objekt_id == objekt.id)) or 0) + 1
                db.add(Berechnung(
                    objekt_id=objekt.id, version=version, art="auswertung",
                    rechenkern_version=auswertung["rechenkern_version"], eingaben=eingabe, ergebnis=auswertung,
                    bemerkung=f"Freigabe {daten.bemerkung}".strip(), erstellt_von_id=pruefer.id,
                ))
        else:
            projekt.geprueft_von_id = projekt.geprueft_am = None
            projekt.freigegeben_von_id = projekt.freigegeben_am = None
        projekt.status = daten.status
    db.commit()
    db.refresh(projekt)
    return projekt


@router.post("/{projekt_id}/auschecken", response_model=AuscheckenAntwort)
def auschecken(
    projekt_id: int, daten: Auschecken, db: Session = Depends(get_db),
    benutzer: Benutzer = Depends(aktueller_benutzer),
):
    """Sperrt das Projekt für die Offline-Bearbeitung auf diesem Gerät. Erneutes Auschecken durch dasselbe Gerät
    (mit seinem Sperr-Token) behält die Sperre."""
    projekt = hole_oder_404(db, Projekt, projekt_id)
    if projekt.status == "freigegeben":
        raise HTTPException(status.HTTP_409_CONFLICT, "Freigegebene Projekte können nicht ausgecheckt werden.")
    if haelt_sperre(db, projekt):
        return AuscheckenAntwort(projekt=ProjektLesen.model_validate(projekt), sperre=db.info["sperre"])
    if projekt.ausgecheckt_am is not None:
        db.info["sperre"] = None
        sperre_pruefen(db, projekt)  # wirft 423 mit Angabe, wer das Projekt hat
    token = secrets.token_urlsafe(32)
    projekt.ausgecheckt_von_id = benutzer.id
    projekt.ausgecheckt_geraet = daten.geraet
    projekt.ausgecheckt_am = datetime.now(UTC)
    projekt.sperre_hash = sperre_hash(token)
    db.commit()
    db.refresh(projekt)
    return AuscheckenAntwort(projekt=ProjektLesen.model_validate(projekt), sperre=token)


@router.post("/{projekt_id}/einchecken", response_model=ProjektLesen)
def einchecken(projekt_id: int, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    """Hebt die Offline-Sperre auf: durch das auscheckende Gerät oder durch einen Admin („Sperre lösen“)."""
    projekt = hole_oder_404(db, Projekt, projekt_id)
    if projekt.ausgecheckt_am is None:
        return projekt
    if not haelt_sperre(db, projekt) and benutzer.rolle != "admin":
        raise HTTPException(
            status.HTTP_423_LOCKED,
            f"Nur das Gerät „{projekt.ausgecheckt_geraet}“ von {projekt.ausgecheckt_von_name} "
            "oder ein Admin kann die Sperre aufheben.",
        )
    projekt.ausgecheckt_von_id = projekt.ausgecheckt_geraet = projekt.ausgecheckt_am = projekt.sperre_hash = None
    db.commit()
    db.refresh(projekt)
    return projekt


@router.delete("/{projekt_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(nur_admin)])
def loeschen(projekt_id: int, db: Session = Depends(get_db)):
    db.delete(hole_oder_404(db, Projekt, projekt_id))
    db.commit()


@router.get("/{projekt_id}/protokoll", response_model=list[ProtokollLesen])
def protokoll(projekt_id: int, db: Session = Depends(get_db)):
    hole_oder_404(db, Projekt, projekt_id)
    eintraege = db.scalars(
        select(Protokoll).where(Protokoll.projekt_id == projekt_id)
        .options(selectinload(Protokoll.benutzer)).order_by(Protokoll.id.desc()).limit(500)
    ).all()
    return [protokoll_lesen(e) for e in eintraege]


def protokoll_lesen(e: Protokoll) -> ProtokollLesen:
    return ProtokollLesen(
        id=e.id, zeitpunkt=e.zeitpunkt, benutzer_id=e.benutzer_id,
        benutzer_name=e.benutzer.name if e.benutzer else "System", projekt_id=e.projekt_id,
        objektart=e.objektart, objekt_id=e.objekt_id, aktion=e.aktion, aenderungen=e.aenderungen,
    )
