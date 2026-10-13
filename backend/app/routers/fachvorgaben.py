"""Zentrale Fachvorgaben: lesen alle, pflegen Fachprüfer und Admins. Änderungen landen im Protokoll."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404, vorgaben_pflege
from app.auswertung import fachvorgaben_laden
from app.db import get_db
from app.models import BibRaumtyp, Fachvorgaben, HeizlastPauschale, Protokoll
from app.routers.projekte import protokoll_lesen
from app.schemas import (
    GEBAEUDESTANDARD_TEXT, FachvorgabenGesamt, FachvorgabenLesen, FachvorgabenWerte, PauschaleLesen,
    PauschaleSetzen, ProtokollLesen, RaumtypAenderung, RaumtypLesen, RaumtypNeu,
)

router = APIRouter(prefix="/fachvorgaben", tags=["Fachvorgaben"], dependencies=[Depends(aktueller_benutzer)])

VORGABEN_OBJEKTARTEN = ("Fachvorgaben", "BibRaumtyp", "HeizlastPauschale", "BibBauteil", "BibKlimadaten")


@router.get("", response_model=FachvorgabenGesamt)
def lesen(db: Session = Depends(get_db)):
    werte = db.get(Fachvorgaben, 1)
    if werte is None:  # sollte durch die Migration nie fehlen
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Fachvorgaben-Datensatz fehlt")
    return FachvorgabenGesamt(
        werte=FachvorgabenLesen.model_validate(werte),
        raumtypen=db.scalars(select(BibRaumtyp).order_by(BibRaumtyp.reihenfolge, BibRaumtyp.bezeichnung)).all(),
        pauschalen=db.scalars(select(HeizlastPauschale)).all(),
        gebaeudestandards=GEBAEUDESTANDARD_TEXT,
    )


@router.put("/werte", response_model=FachvorgabenLesen, dependencies=[Depends(vorgaben_pflege)])
def werte_setzen(daten: FachvorgabenWerte, db: Session = Depends(get_db)):
    werte = fachvorgaben_laden(db)
    for name, wert in daten.model_dump().items():
        setattr(werte, name, wert)
    db.add(werte)
    db.commit()
    db.refresh(werte)
    return werte


@router.post("/raumtypen", response_model=RaumtypLesen, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(vorgaben_pflege)])
def raumtyp_anlegen(daten: RaumtypNeu, db: Session = Depends(get_db)):
    raumtyp = BibRaumtyp(**daten.model_dump())
    db.add(raumtyp)
    db.commit()
    return raumtyp


@router.patch("/raumtypen/{raumtyp_id}", response_model=RaumtypLesen, dependencies=[Depends(vorgaben_pflege)])
def raumtyp_aendern(raumtyp_id: int, daten: RaumtypAenderung, db: Session = Depends(get_db)):
    raumtyp = hole_oder_404(db, BibRaumtyp, raumtyp_id)
    for name, wert in daten.model_dump(exclude_unset=True).items():
        setattr(raumtyp, name, wert)
    db.commit()
    return raumtyp


@router.delete("/raumtypen/{raumtyp_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(vorgaben_pflege)])
def raumtyp_loeschen(raumtyp_id: int, db: Session = Depends(get_db)):
    db.delete(hole_oder_404(db, BibRaumtyp, raumtyp_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Raumtyp wird in Projekten verwendet und kann nicht gelöscht werden") from None


@router.put("/pauschalen", response_model=PauschaleLesen | None, dependencies=[Depends(vorgaben_pflege)])
def pauschale_setzen(daten: PauschaleSetzen, db: Session = Depends(get_db)):
    hole_oder_404(db, BibRaumtyp, daten.raumtyp_id)
    if daten.gebaeudestandard == "sonstiger_bestand":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Für „Altbau (nicht Effizienzhaus)“ gibt es keine Tabellenwerte – der Fachprüfer legt die Pauschale je Raum fest.",
        )
    eintrag = db.scalars(select(HeizlastPauschale).where(
        HeizlastPauschale.raumtyp_id == daten.raumtyp_id,
        HeizlastPauschale.gebaeudestandard == daten.gebaeudestandard,
    )).one_or_none()
    if daten.w_m2 is None:
        if eintrag is not None:
            db.delete(eintrag)
            db.commit()
        return None
    if eintrag is None:
        eintrag = HeizlastPauschale(raumtyp_id=daten.raumtyp_id, gebaeudestandard=daten.gebaeudestandard)
        db.add(eintrag)
    eintrag.w_m2, eintrag.quelle = daten.w_m2, daten.quelle
    db.commit()
    return eintrag


@router.get("/protokoll", response_model=list[ProtokollLesen])
def protokoll(db: Session = Depends(get_db)):
    eintraege = db.scalars(
        select(Protokoll).where(Protokoll.objektart.in_(VORGABEN_OBJEKTARTEN))
        .options(selectinload(Protokoll.benutzer)).order_by(Protokoll.id.desc()).limit(500)
    ).all()
    return [protokoll_lesen(e) for e in eintraege]
