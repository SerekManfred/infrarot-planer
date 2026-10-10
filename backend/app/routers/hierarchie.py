"""Einheitliche Endpunkte für Objekt, Geschoss, Raum, Bauteilfläche und Öffnung.

Muster je Ebene:
  GET/POST   /{eltern}/{eltern_id}/{kinder}
  GET/PATCH/DELETE /{kinder}/{id}
"""
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404
from app.db import Base, get_db
from app.projektzugriff import bearbeitung_pruefen
from app.models import Bauteilflaeche, Geschoss, Objekt, Oeffnung, Projekt, Raum
from app.schemas import (
    FlaecheAenderung, FlaecheLesen, FlaecheNeu, GeschossAenderung, GeschossLesen, GeschossNeu,
    ObjektAenderung, ObjektLesen, ObjektNeu, OeffnungAenderung, OeffnungLesen, OeffnungNeu,
    RaumAenderung, RaumLesen, RaumNeu,
)

router = APIRouter(dependencies=[Depends(aktueller_benutzer)])


def _ebene(
    *, eltern: type[Base], eltern_pfad: str, model: type[Base], pfad: str, fk: str, titel: str,
    Neu: type[BaseModel], Aenderung: type[BaseModel], Lesen: type[BaseModel], sortierung,
    vor_speichern=None,
) -> None:
    tags = [titel]

    @router.get(f"/{eltern_pfad}/{{eltern_id}}/{pfad}", response_model=list[Lesen], tags=tags,
                name=f"{pfad}_auflisten")
    def auflisten(eltern_id: int, db: Session = Depends(get_db)):
        hole_oder_404(db, eltern, eltern_id)
        return db.scalars(select(model).where(getattr(model, fk) == eltern_id).order_by(*sortierung)).all()

    @router.post(f"/{eltern_pfad}/{{eltern_id}}/{pfad}", response_model=Lesen,
                 status_code=status.HTTP_201_CREATED, tags=tags, name=f"{pfad}_anlegen")
    def anlegen(eltern_id: int, daten: Neu, db: Session = Depends(get_db)):
        bearbeitung_pruefen(db, hole_oder_404(db, eltern, eltern_id))
        obj = model(**daten.model_dump(), **{fk: eltern_id})
        if vor_speichern:
            vor_speichern(obj)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @router.get(f"/{pfad}/{{obj_id}}", response_model=Lesen, tags=tags, name=f"{pfad}_lesen")
    def lesen(obj_id: int, db: Session = Depends(get_db)):
        return hole_oder_404(db, model, obj_id)

    @router.patch(f"/{pfad}/{{obj_id}}", response_model=Lesen, tags=tags, name=f"{pfad}_aendern")
    def aendern(obj_id: int, daten: Aenderung, db: Session = Depends(get_db)):
        obj = hole_oder_404(db, model, obj_id)
        bearbeitung_pruefen(db, obj)
        for name, wert in daten.model_dump(exclude_unset=True).items():
            setattr(obj, name, wert)
        if vor_speichern:
            vor_speichern(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @router.delete(f"/{pfad}/{{obj_id}}", status_code=status.HTTP_204_NO_CONTENT, tags=tags,
                   name=f"{pfad}_loeschen")
    def loeschen(obj_id: int, db: Session = Depends(get_db)):
        obj = hole_oder_404(db, model, obj_id)
        bearbeitung_pruefen(db, obj)
        db.delete(obj)
        db.commit()


def _raum_flaeche(raum: Raum) -> None:
    """Schnellerfassung: Fläche des Rechteckraums aus Länge × Breite."""
    if raum.laenge_m is not None and raum.breite_m is not None:
        raum.flaeche_m2 = raum.laenge_m * raum.breite_m


_ebene(eltern=Projekt, eltern_pfad="projekte", model=Objekt, pfad="objekte", fk="projekt_id", titel="Objekte",
       Neu=ObjektNeu, Aenderung=ObjektAenderung, Lesen=ObjektLesen, sortierung=[Objekt.id])
_ebene(eltern=Objekt, eltern_pfad="objekte", model=Geschoss, pfad="geschosse", fk="objekt_id", titel="Geschosse",
       Neu=GeschossNeu, Aenderung=GeschossAenderung, Lesen=GeschossLesen,
       sortierung=[Geschoss.reihenfolge, Geschoss.id])
_ebene(eltern=Geschoss, eltern_pfad="geschosse", model=Raum, pfad="raeume", fk="geschoss_id", titel="Räume",
       Neu=RaumNeu, Aenderung=RaumAenderung, Lesen=RaumLesen, sortierung=[Raum.id], vor_speichern=_raum_flaeche)
_ebene(eltern=Raum, eltern_pfad="raeume", model=Bauteilflaeche, pfad="flaechen", fk="raum_id",
       titel="Bauteilflächen", Neu=FlaecheNeu, Aenderung=FlaecheAenderung, Lesen=FlaecheLesen,
       sortierung=[Bauteilflaeche.id])
_ebene(eltern=Bauteilflaeche, eltern_pfad="flaechen", model=Oeffnung, pfad="oeffnungen", fk="bauteilflaeche_id",
       titel="Öffnungen", Neu=OeffnungNeu, Aenderung=OeffnungAenderung, Lesen=OeffnungLesen,
       sortierung=[Oeffnung.id])
