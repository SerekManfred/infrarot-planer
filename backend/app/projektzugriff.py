"""Zuordnung beliebiger Projektdaten zu ihrem Projekt, Sichtbarkeit und Prüfung, ob das Projekt bearbeitet werden darf.

Sichtbarkeit (Festlegung 31.10.2026): Benutzer mit nur der Rolle Außendienst sehen ausschließlich Projekte, die sie
angelegt haben oder die ihnen zugewiesen sind; Fachprüfer und Admins sehen alle. Geprüft wird serverseitig beim
Laden jedes Projekt-Datensatzes (abhaengigkeiten.hole_oder_404), in der Projektliste und im Offline-Paket.
Fremde Projekte gelten als „nicht gefunden“ (404), damit nicht einmal ihre Existenz sichtbar wird.

Offline-Sperre: Hat ein Gerät ein Projekt ausgecheckt, darf nur dieses Gerät (gleicher Benutzer und
passendes Sperr-Token im Kopf X-Sperre) es ändern. Alle anderen erhalten 423 mit Angabe, wer es hat.
"""
import hashlib
import hmac

from fastapi import HTTPException, status
from sqlalchemy import or_
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


# db.info-Schlüssel: Benutzer-ID, wenn die Anfrage nur Projekte dieses Außendienst-Benutzers sehen darf
NUR_EIGENE = "nur_eigene_projekte"


def nur_eigene(benutzer) -> bool:
    """Nur Außendienst (ohne Fachprüfer/Admin): sieht nur eigene bzw. zugewiesene Projekte."""
    return not benutzer.hat_rolle("fachpruefer", "admin")


def sichtbar(db: Session, projekt: Projekt) -> bool:
    benutzer_id = db.info.get(NUR_EIGENE)
    return benutzer_id is None or benutzer_id in (projekt.ersteller_id, projekt.zugewiesen_an_id)


def sichtbarkeit_filter(db: Session):
    """WHERE-Bedingung für Projektabfragen (oder True, wenn alles sichtbar ist)."""
    benutzer_id = db.info.get(NUR_EIGENE)
    if benutzer_id is None:
        return True
    return or_(Projekt.ersteller_id == benutzer_id, Projekt.zugewiesen_an_id == benutzer_id)


def sichtbarkeit_pruefen(db: Session, obj: object) -> None:
    """404, wenn der Datensatz zu einem Projekt gehört, das der Benutzer nicht sehen darf."""
    if db.info.get(NUR_EIGENE) is None:
        return
    projekt_id = obj.id if isinstance(obj, Projekt) else projekt_id_von(db, obj)
    projekt = obj if isinstance(obj, Projekt) else (db.get(Projekt, projekt_id) if projekt_id is not None else None)
    if projekt is not None and not sichtbar(db, projekt):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projekt nicht gefunden oder kein Zugriff")


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


def sperre_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def haelt_sperre(db: Session, projekt: Projekt) -> bool:
    """Ob die laufende Anfrage vom Gerät kommt, das das Projekt ausgecheckt hat."""
    token = db.info.get("sperre")
    return bool(
        projekt.ausgecheckt_am is not None and token and projekt.sperre_hash
        and hmac.compare_digest(sperre_hash(token), projekt.sperre_hash)
        and db.info.get("benutzer_id") == projekt.ausgecheckt_von_id
    )


def sperre_pruefen(db: Session, projekt: Projekt) -> None:
    """Wirft 423, wenn ein anderes Gerät das Projekt ausgecheckt hat, und 409, wenn die Sperre des Geräts aufgehoben wurde."""
    if projekt.ausgecheckt_am is None:
        if db.info.get("sperre"):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Die Offline-Sperre dieses Geräts für das Projekt wurde aufgehoben. Änderungen werden nicht übertragen.",
            )
        return
    if not haelt_sperre(db, projekt):
        raise HTTPException(
            status.HTTP_423_LOCKED,
            f"Projekt ist zur Offline-Bearbeitung ausgecheckt von {projekt.ausgecheckt_von_name} "
            f"(Gerät „{projekt.ausgecheckt_geraet}“). Änderungen erst nach dem Einchecken "
            "oder wenn ein Admin die Sperre löst.",
        )


def bearbeitung_pruefen(db: Session, obj: object) -> None:
    """Freigegebene Projekte sind gesperrt; geprüfte fallen bei Änderung auf „Vor-Ort-Entwurf“ zurück."""
    projekt_id = projekt_id_von(db, obj)
    projekt = db.get(Projekt, projekt_id) if projekt_id is not None else None
    if projekt is None:
        return
    sperre_pruefen(db, projekt)
    if projekt.status == "freigegeben":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Projekt ist freigegeben und gesperrt. Zum Ändern muss ein Fachprüfer es zurück auf „Vor-Ort-Entwurf“ setzen.",
        )
    if projekt.status == "geprueft":
        projekt.status = "entwurf"
        projekt.geprueft_von_id = None
        projekt.geprueft_am = None
