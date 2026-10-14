"""Änderungsprotokoll: Jede Änderung an Projekt- und Vorgabedaten wird mit Benutzer und Zeit festgehalten.

Umsetzung über das SQLAlchemy-Ereignis after_flush, damit kein Endpunkt das Protokollieren vergessen kann.
Den handelnden Benutzer setzt app.abhaengigkeiten.aktueller_benutzer in db.info["benutzer_id"];
fehlt er (Kommandozeile, Migration), bleibt benutzer_id leer.
"""
from datetime import UTC, date, datetime

from sqlalchemy import event, func, inspect, insert, update
from sqlalchemy.orm import Session

from app.models import (
    BibBauteil, BibKlimadaten, BibModul, BibRaumtyp, Bauteilflaeche, Benutzer, Berechnung, Fachvorgaben, Geschoss,
    HeizlastPauschale, Objekt, Oeffnung, Platzierungsregel, Projekt, Protokoll, Raum,
)
from app.projektzugriff import projekt_id_von

PROTOKOLLIERT = (
    Benutzer, Projekt, Objekt, Geschoss, Raum, Bauteilflaeche, Oeffnung, Berechnung,
    BibRaumtyp, HeizlastPauschale, Fachvorgaben, BibBauteil, BibKlimadaten, Platzierungsregel, BibModul,
)
# vorgaben_stand(_am), vorgaben_abgelehnt(_am): eigene, lesbare Einträge „vorgaben_uebernommen“ und
# „vorgaben_abgelehnt“ (app/routers/projekte.py)
NICHT_PROTOKOLLIERT = {
    "id", "erstellt_am", "geaendert_am", "sitzungs_version", "eingaben", "ergebnis", "sperre_hash",
    "vorgaben_stand", "vorgaben_stand_am", "vorgaben_abgelehnt", "vorgaben_abgelehnt_am",
}
BESCHRIFTUNG = ("bezeichnung", "nummer", "email", "gebaeudestandard")


def _json(wert: object) -> object:
    if isinstance(wert, (datetime, date)):
        return wert.isoformat()
    if wert is None or isinstance(wert, (str, int, float, bool, list, dict)):
        return wert
    return str(wert)


def _aenderungen(obj: object, aktion: str) -> dict:
    zustand = inspect(obj)
    ergebnis: dict = {}
    for attr in zustand.mapper.column_attrs:
        name = attr.key
        if name in NICHT_PROTOKOLLIERT:
            continue
        if aktion == "geaendert":
            verlauf = zustand.attrs[name].history
            if not verlauf.has_changes():
                continue
            alt = verlauf.deleted[0] if verlauf.deleted else None
            neu = verlauf.added[0] if verlauf.added else None
            if alt == neu:
                continue
            if name == "passwort_hash":
                ergebnis["passwort"] = "geändert"
            else:
                ergebnis[name] = [_json(alt), _json(neu)]
        elif aktion == "angelegt":
            wert = zustand.dict.get(name)
            if wert is not None and name != "passwort_hash":
                ergebnis[name] = _json(wert)
        else:  # geloescht: nur zur Wiedererkennung
            if name in BESCHRIFTUNG and zustand.dict.get(name) is not None:
                ergebnis[name] = _json(zustand.dict[name])
    return ergebnis


@event.listens_for(Session, "after_flush")
def _protokollieren(session: Session, _flush_kontext) -> None:
    benutzer_id = session.info.get("benutzer_id")
    jetzt = datetime.now(UTC)
    zeilen = []
    geaenderte_projekte: set[int] = set()
    for aktion, menge in (("angelegt", session.new), ("geaendert", session.dirty), ("geloescht", session.deleted)):
        for obj in menge:
            if not isinstance(obj, PROTOKOLLIERT):
                continue
            aenderungen = _aenderungen(obj, aktion)
            if aktion == "geaendert" and not aenderungen:
                continue
            identitaet = inspect(obj).identity
            objekt_id = identitaet[0] if identitaet else None
            if objekt_id is not None and not isinstance(objekt_id, int):
                # Text-Schlüssel (Platzierungsregel): im Eintrag statt in objekt_id
                aenderungen = {"schluessel": objekt_id, **aenderungen}
                objekt_id = None
            projekt_id = projekt_id_von(session, obj)
            zeilen.append({
                "zeitpunkt": jetzt, "benutzer_id": benutzer_id, "projekt_id": projekt_id,
                "objektart": type(obj).__name__, "objekt_id": objekt_id,
                "aktion": aktion, "aenderungen": aenderungen,
            })
            if projekt_id is not None and not (aktion == "geloescht" and isinstance(obj, Projekt)):
                geaenderte_projekte.add(projekt_id)
    verbindung = session.connection()
    if zeilen:
        verbindung.execute(insert(Protokoll.__table__), zeilen)
    if geaenderte_projekte:
        tabelle = Projekt.__table__
        verbindung.execute(update(tabelle).where(tabelle.c.id.in_(geaenderte_projekte)).values(geaendert_am=func.now()))
