"""Zentrale Fachvorgaben: lesen alle, pflegen Fachprüfer und Admins. Änderungen landen im Protokoll.

Nach jeder Änderung werden die Projekte abgeglichen (app/vorgabenabgleich.py): ohne Auswirkung stillschweigend
übernommen, mit Auswirkung „wartet auf Fachprüfer“. Vor dem Speichern zeigt /vorschau, welche Projekte betroffen wären;
/abgleich ist die Sammelansicht des Fachprüfers.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404, nur_fachpruefer, vorgaben_pflege
from app.auswertung import fachvorgaben_laden
from app.db import get_db
from app.models import Benutzer, BibRaumtyp, Fachvorgaben, HeizlastPauschale, Platzierungsregel, Protokoll
from app.routers.projekte import protokoll_lesen, vorgaben_ablehnen, vorgaben_uebernehmen
from app.schemas import (
    GEBAEUDESTANDARD_TEXT, FachvorgabenGesamt, FachvorgabenLesen, FachvorgabenWerte, PauschaleLesen,
    AbgleichProjekt, PauschaleSetzen, ProtokollLesen, RaumtypAenderung, RaumtypLesen, RaumtypNeu, RegelAenderung,
    RegelLesen, SammelEntscheidung, SammelErgebnis, VorgabenAblehnen, VorschauAnfrage, VorschauErgebnis,
)
from app.vorgabenabgleich import abgleichen, betroffene, vorschau as vorschau_berechnen

router = APIRouter(prefix="/fachvorgaben", tags=["Fachvorgaben"], dependencies=[Depends(aktueller_benutzer)])

VORGABEN_OBJEKTARTEN = (
    "Fachvorgaben", "BibRaumtyp", "HeizlastPauschale", "Platzierungsregel", "BibBauteil", "BibKlimadaten", "BibModul",
)


@router.get("", response_model=FachvorgabenGesamt)
def lesen(db: Session = Depends(get_db)):
    werte = db.get(Fachvorgaben, 1)
    if werte is None:  # sollte durch die Migration nie fehlen
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Fachvorgaben-Datensatz fehlt")
    return FachvorgabenGesamt(
        werte=FachvorgabenLesen.model_validate(werte),
        raumtypen=db.scalars(select(BibRaumtyp).order_by(BibRaumtyp.reihenfolge, BibRaumtyp.bezeichnung)).all(),
        pauschalen=db.scalars(select(HeizlastPauschale)).all(),
        regeln=db.scalars(select(Platzierungsregel).order_by(Platzierungsregel.reihenfolge)).all(),
        gebaeudestandards=GEBAEUDESTANDARD_TEXT,
    )


@router.patch("/regeln/{schluessel}", response_model=RegelLesen, dependencies=[Depends(vorgaben_pflege)])
def regel_aendern(schluessel: str, daten: RegelAenderung, db: Session = Depends(get_db)):
    """Wert und Quelle einer Platzierungsregel ändern (die Liste der Regeln ist fest)."""
    regel = db.get(Platzierungsregel, schluessel)
    if regel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Platzierungsregel {schluessel} nicht gefunden")
    for name, wert in daten.model_dump(exclude_unset=True).items():
        setattr(regel, name, "" if wert is None and name != "wert" else wert)
    db.commit()
    _abgleichen(db)
    db.refresh(regel)
    return regel


@router.put("/werte", response_model=FachvorgabenLesen, dependencies=[Depends(vorgaben_pflege)])
def werte_setzen(daten: FachvorgabenWerte, db: Session = Depends(get_db)):
    werte = fachvorgaben_laden(db)
    for name, wert in daten.model_dump().items():
        setattr(werte, name, wert)
    db.add(werte)
    db.commit()
    _abgleichen(db)
    db.refresh(werte)
    return werte


@router.post("/raumtypen", response_model=RaumtypLesen, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(vorgaben_pflege)])
def raumtyp_anlegen(daten: RaumtypNeu, db: Session = Depends(get_db)):
    raumtyp = BibRaumtyp(**daten.model_dump())
    db.add(raumtyp)
    db.commit()
    _abgleichen(db)
    db.refresh(raumtyp)
    return raumtyp


@router.patch("/raumtypen/{raumtyp_id}", response_model=RaumtypLesen, dependencies=[Depends(vorgaben_pflege)])
def raumtyp_aendern(raumtyp_id: int, daten: RaumtypAenderung, db: Session = Depends(get_db)):
    raumtyp = hole_oder_404(db, BibRaumtyp, raumtyp_id)
    for name, wert in daten.model_dump(exclude_unset=True).items():
        setattr(raumtyp, name, wert)
    db.commit()
    _abgleichen(db)
    db.refresh(raumtyp)
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
    _abgleichen(db)


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
            _abgleichen(db)
        return None
    if eintrag is None:
        eintrag = HeizlastPauschale(raumtyp_id=daten.raumtyp_id, gebaeudestandard=daten.gebaeudestandard)
        db.add(eintrag)
    eintrag.w_m2, eintrag.quelle = daten.w_m2, daten.quelle
    db.commit()
    _abgleichen(db)
    db.refresh(eintrag)
    return eintrag


@router.get("/protokoll", response_model=list[ProtokollLesen])
def protokoll(db: Session = Depends(get_db)):
    eintraege = db.scalars(
        select(Protokoll).where(Protokoll.objektart.in_(VORGABEN_OBJEKTARTEN))
        .options(selectinload(Protokoll.benutzer)).order_by(Protokoll.id.desc()).limit(500)
    ).all()
    return [protokoll_lesen(e) for e in eintraege]


def _abgleichen(db: Session) -> dict:
    """Projekte nach einer zentralen Änderung abgleichen (handelnder Benutzer fürs Protokoll aus der Anfrage)."""
    return abgleichen(db, db.info.get("benutzer_id"))


_VORSCHAU_SCHEMAS = {
    "werte": FachvorgabenWerte, "raumtyp_neu": RaumtypNeu, "raumtyp_aendern": RaumtypAenderung,
    "pauschale": PauschaleSetzen, "regel": RegelAenderung,
}


@router.post("/vorschau", response_model=VorschauErgebnis, dependencies=[Depends(vorgaben_pflege)])
def vorschau(anfrage: VorschauAnfrage, db: Session = Depends(get_db)):
    """Welche Projekte eine geplante Änderung beträfe – vor dem Speichern, ohne etwas zu speichern."""
    schema = _VORSCHAU_SCHEMAS.get(anfrage.art)
    daten = schema.model_validate(anfrage.daten).model_dump(exclude_unset=anfrage.art != "werte") if schema else {}
    return vorschau_berechnen(db, anfrage.art, anfrage.ziel, daten)


@router.get("/abgleich", response_model=list[AbgleichProjekt], dependencies=[Depends(nur_fachpruefer)])
def abgleich(db: Session = Depends(get_db)):
    """Sammelansicht: Projekte, die auf die Entscheidung über neue Fachvorgaben warten, mit Auswirkung."""
    return betroffene(db)


@router.post("/abgleich", response_model=list[SammelErgebnis])
def abgleich_entscheiden(
    daten: SammelEntscheidung, db: Session = Depends(get_db), benutzer: Benutzer = Depends(nur_fachpruefer)
):
    """Für mehrere Projekte übernehmen oder bewusst ablehnen – je Projekt wie die Einzelentscheidung protokolliert."""
    ergebnisse = []
    for projekt_id in daten.projekt_ids:
        try:
            if daten.aktion == "uebernehmen":
                vorgaben_uebernehmen(projekt_id, db, benutzer)
            else:
                vorgaben_ablehnen(projekt_id, VorgabenAblehnen(bemerkung=daten.bemerkung), db, benutzer)
            ergebnisse.append(SammelErgebnis(projekt_id=projekt_id, ok=True))
        except HTTPException as fehler:
            db.rollback()
            ergebnisse.append(SammelErgebnis(projekt_id=projekt_id, ok=False, meldung=str(fehler.detail)))
    return ergebnisse
