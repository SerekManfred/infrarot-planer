"""Zuordnung beliebiger Projektdaten zu ihrem Projekt und Prüfung, ob das Projekt bearbeitet werden darf."""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Bauteilflaeche, Berechnung, Geschoss, Objekt, Oeffnung, Projekt, Raum

# Objektart → (Fremdschlüssel zum Elternteil, Elternklasse)
_ELTERN = {
    Objekt: ("projekt_id", Projekt),
    Geschoss: ("objekt_id", Objekt),
    Raum: ("geschoss_id", Geschoss),
    Bauteilflaeche: ("raum_id", Raum),
    Oeffnung: ("bauteilflaeche_id", Bauteilflaeche),
    Berechnung: ("objekt_id", Objekt),
}


def projekt_id_von(db: Session, obj: object) -> int | None:
    """Projekt-ID über die Fremdschlüssel; None für Daten ohne Projektbezug (Fachvorgaben, Benutzer …)."""
    while not isinstance(obj, Projekt):
        eintrag = _ELTERN.get(type(obj))
        if eintrag is None:
            return None
        fk, eltern = eintrag
        eltern_id = getattr(obj, fk)
        obj = db.get(eltern, eltern_id) if eltern_id is not None else None
        if obj is None:
            return None
    return obj.id


def bearbeitung_pruefen(db: Session, obj: object) -> None:
    """Freigegebene Projekte sind gesperrt; geprüfte fallen bei Änderung auf „Vor-Ort-Entwurf“ zurück."""
    projekt_id = projekt_id_von(db, obj)
    projekt = db.get(Projekt, projekt_id) if projekt_id is not None else None
    if projekt is None:
        return
    if projekt.status == "freigegeben":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Projekt ist freigegeben und gesperrt. Zum Ändern muss ein Fachprüfer es zurück auf „Vor-Ort-Entwurf“ setzen.",
        )
    if projekt.status == "geprueft":
        projekt.status = "entwurf"
        projekt.geprueft_von_id = None
        projekt.geprueft_am = None
