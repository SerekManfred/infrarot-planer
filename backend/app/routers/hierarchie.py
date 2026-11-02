"""Einheitliche Endpunkte für Objekt, Geschoss, Raum, Bauteilfläche und Öffnung.

Muster je Ebene:
  GET/POST   /{eltern}/{eltern_id}/{kinder}
  GET/PATCH/DELETE /{kinder}/{id}

W/m²-Pauschalen (je Raum und je Projekt) setzt nur die Rolle Fachprüfer; der Außendienst sieht sie nur
(Festlegung 13.10.2026).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404
from app.db import Base, get_db
from app.projektzugriff import bearbeitung_pruefen
from app.models import Bauteilflaeche, Benutzer, Geschoss, Objekt, Oeffnung, Projekt, Raum
from app.schemas import (
    FlaecheAenderung, FlaecheLesen, FlaecheNeu, GeschossAenderung, GeschossLesen, GeschossNeu,
    ObjektAenderung, ObjektLesen, ObjektNeu, OeffnungAenderung, OeffnungLesen, OeffnungNeu,
    RaumAenderung, RaumLesen, RaumNeu,
)

router = APIRouter(dependencies=[Depends(aktueller_benutzer)])


def _ebene(
    *, eltern: type[Base], eltern_pfad: str, model: type[Base], pfad: str, fk: str, titel: str,
    Neu: type[BaseModel], Aenderung: type[BaseModel], Lesen: type[BaseModel], sortierung,
    vor_speichern=None, nur_fachpruefer: tuple[str, ...] = (),
) -> None:
    tags = [titel]

    def felder_pruefen(benutzer: Benutzer, werte: dict, obj: Base | None = None) -> None:
        """Felder, die nur Fachprüfer setzen dürfen: 403, wenn sich ihr Wert ändern würde."""
        if benutzer.hat_rolle("fachpruefer"):
            return
        for feld in nur_fachpruefer:
            if feld in werte and werte[feld] != (getattr(obj, feld) if obj is not None else None):
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN, "Die W/m²-Pauschale legt der Fachprüfer fest (Rolle Fachprüfer nötig)."
                )

    @router.get(f"/{eltern_pfad}/{{eltern_id}}/{pfad}", response_model=list[Lesen], tags=tags,
                name=f"{pfad}_auflisten")
    def auflisten(eltern_id: int, db: Session = Depends(get_db)):
        hole_oder_404(db, eltern, eltern_id)
        return db.scalars(select(model).where(getattr(model, fk) == eltern_id).order_by(*sortierung)).all()

    @router.post(f"/{eltern_pfad}/{{eltern_id}}/{pfad}", response_model=Lesen,
                 status_code=status.HTTP_201_CREATED, tags=tags, name=f"{pfad}_anlegen")
    def anlegen(
        eltern_id: int, daten: Neu, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)
    ):
        bearbeitung_pruefen(db, hole_oder_404(db, eltern, eltern_id))
        werte = daten.model_dump()
        felder_pruefen(benutzer, {k: v for k, v in werte.items() if v not in (None, {})})
        obj = model(**werte, **{fk: eltern_id})
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
    def aendern(
        obj_id: int, daten: Aenderung, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)
    ):
        obj = hole_oder_404(db, model, obj_id)
        bearbeitung_pruefen(db, obj)
        werte = daten.model_dump(exclude_unset=True)
        felder_pruefen(benutzer, werte, obj)
        for name, wert in werte.items():
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
    """Schnellerfassung: Fläche des Rechteckraums aus Länge × Breite.

    Raumform aus Rechtecken (Paket M2): Das Hauptrechteck der Geometrie folgt immer Länge × Breite. Mit Anbauten oder
    Ausschnitten bestimmt der Rechenkern die Fläche (die Oberfläche schickt sie mit); die Auswertung rechnet ohnehin
    mit der Fläche der Raumform.
    """
    if raum.laenge_m is None or raum.breite_m is None:
        return
    teile = (raum.geometrie or {}).get("teile") or []
    raum.geometrie = {"basis": {"w": raum.laenge_m, "h": raum.breite_m}, "teile": teile}
    if not teile:
        raum.flaeche_m2 = raum.laenge_m * raum.breite_m


_ebene(eltern=Projekt, eltern_pfad="projekte", model=Objekt, pfad="objekte", fk="projekt_id", titel="Objekte",
       Neu=ObjektNeu, Aenderung=ObjektAenderung, Lesen=ObjektLesen, sortierung=[Objekt.id],
       nur_fachpruefer=("pauschale_abweichungen",))
_ebene(eltern=Objekt, eltern_pfad="objekte", model=Geschoss, pfad="geschosse", fk="objekt_id", titel="Geschosse",
       Neu=GeschossNeu, Aenderung=GeschossAenderung, Lesen=GeschossLesen,
       sortierung=[Geschoss.reihenfolge, Geschoss.id])
_ebene(eltern=Geschoss, eltern_pfad="geschosse", model=Raum, pfad="raeume", fk="geschoss_id", titel="Räume",
       Neu=RaumNeu, Aenderung=RaumAenderung, Lesen=RaumLesen, sortierung=[Raum.id], vor_speichern=_raum_flaeche,
       nur_fachpruefer=("pauschale_w_m2",))
_ebene(eltern=Raum, eltern_pfad="raeume", model=Bauteilflaeche, pfad="flaechen", fk="raum_id",
       titel="Bauteilflächen", Neu=FlaecheNeu, Aenderung=FlaecheAenderung, Lesen=FlaecheLesen,
       sortierung=[Bauteilflaeche.id])
_ebene(eltern=Bauteilflaeche, eltern_pfad="flaechen", model=Oeffnung, pfad="oeffnungen", fk="bauteilflaeche_id",
       titel="Öffnungen", Neu=OeffnungNeu, Aenderung=OeffnungAenderung, Lesen=OeffnungLesen,
       sortierung=[Oeffnung.id])
