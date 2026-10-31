"""Verfeinerte Sperre bei geänderten Fachvorgaben (Festlegung Auftraggeber 18.10.2026).

Ein Projekt wartet nur dann auf den Fachprüfer, wenn sich durch neue zentrale Fachvorgaben für dieses Projekt
tatsächlich etwas ändert – je Raum:
- Heizlast: maßgeblich sowie aus Pauschale (A) und Gegenprobe (C) – auch ein geänderter Kontrollwert sperrt,
- benötigte Leistung (bestimmt die Modulauswahl), Leistungswarnungen (Unter-/Überdimensionierung), Thermostate,
- Ergebnis der Regelprüfung (Verstöße je Modul).
Alles andere (neue Raumtypen, die im Projekt nicht vorkommen, Text- und Quellenänderungen, Werte, die das Projekt
nicht nutzt) übernimmt das Projekt stillschweigend; das wird protokolliert, der Status bleibt.

Nach jeder zentralen Änderung ruft der ändernde Endpunkt `abgleichen` auf. Ausgecheckte Projekte werden ebenfalls
abgeglichen: Ihre Ergebnisse ändern sich bei einer stillschweigenden Übernahme definitionsgemäß nicht.
Freigegebene Projekte bleiben unverändert.
"""
import copy
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auswertung import objekt_auswerten
from app.models import Projekt, Protokoll
from app.vorgabenstand import projekt_stand, schnappschuss, unterschiede

GRUND_STILL = "keine Auswirkung auf Heizlast, Module und Regelprüfung"


def _kennwerte(raum: dict) -> tuple:
    """Was je Raum für die Sperre zählt (Hinweistexte ohne Ergebnisänderung zählen nicht)."""
    m = raum.get("modulplanung") or {}
    benoetigt = m.get("benoetigt_w")
    warnungen = (m.get("leistung"), m.get("leistung_hinweis"))
    verstoesse = tuple(sorted((k, tuple(sorted(v))) for k, v in (m.get("verstoesse") or {}).items()))
    return (
        raum.get("phi_massgeblich_w"),
        raum.get("phi_a_w"),
        raum.get("phi_c_w"),
        None if benoetigt is None else round(benoetigt, 6),
        m.get("thermostate"),
        warnungen,
        verstoesse,
    )


def _verstoesse(raum: dict) -> set[str]:
    return {f"{k}:{v}" for k, liste in ((raum.get("modulplanung") or {}).get("verstoesse") or {}).items() for v in liste}


def vergleich(db: Session, projekt: Projekt, alt: dict, neu: dict) -> dict | None:
    """Auswirkung von Fachvorgaben-Stand `alt` → `neu` auf das Projekt; None, wenn sich nichts ändert, was zählt."""
    summe_alt = summe_neu = 0.0
    raeume: list[dict] = []
    neue_verstoesse = 0
    for objekt in projekt.objekte:
        a = objekt_auswerten(db, objekt, alt)[1]
        n = objekt_auswerten(db, objekt, neu)[1]
        summe_alt += a["summe"]["phi_massgeblich_w"]
        summe_neu += n["summe"]["phi_massgeblich_w"]
        for ra, rn in zip(a["raeume"], n["raeume"], strict=True):
            if _kennwerte(ra) == _kennwerte(rn):
                continue
            neu_hier = len(_verstoesse(rn) - _verstoesse(ra))
            neue_verstoesse += neu_hier
            raeume.append({
                "raum_id": ra["raum_id"], "bezeichnung": f"{ra['geschoss']} · {ra['bezeichnung']}",
                "alt_w": ra["phi_massgeblich_w"], "neu_w": rn["phi_massgeblich_w"], "neue_verstoesse": neu_hier,
            })
    if not raeume:
        return None
    return {"summe_alt_w": summe_alt, "summe_neu_w": summe_neu, "raeume": raeume, "neue_verstoesse": neue_verstoesse}


def basis(projekt: Projekt, db: Session) -> dict:
    """Stand, gegen den neue zentrale Vorgaben gemessen werden: ein bewusst abgelehnter Stand, sonst der Projektstand."""
    return projekt.vorgaben_abgelehnt if projekt.vorgaben_abgelehnt is not None else projekt_stand(db, projekt)


def _offene_projekte(db: Session, nur: list[int] | None = None) -> list[Projekt]:
    abfrage = select(Projekt).where(Projekt.status != "freigegeben").order_by(Projekt.id)
    if nur is not None:
        abfrage = abfrage.where(Projekt.id.in_(nur))
    return list(db.scalars(abfrage))


def abgleichen(db: Session, benutzer_id: int | None, nur: list[int] | None = None) -> dict:
    """Gleicht Projekte mit den aktuellen zentralen Vorgaben ab und committet.

    Ohne Auswirkung: stillschweigend übernehmen (bzw. bei bewusst abgelehntem Stand die Ablehnung auf den neuen
    Stand ausdehnen). Mit Auswirkung: bleibt offen („wartet auf Fachprüfer“). Gibt die Projekt-IDs je Ergebnis zurück.
    """
    neu = schnappschuss(db)
    jetzt = datetime.now(UTC)
    still: list[int] = []
    betroffen: list[int] = []
    for projekt in _offene_projekte(db, nur):
        stand = projekt_stand(db, projekt)
        liste = unterschiede(stand, neu)
        if not liste:
            continue
        abgelehnt = projekt.vorgaben_abgelehnt
        if abgelehnt is not None and not unterschiede(abgelehnt, neu):
            continue  # seit der Ablehnung zentral nichts Rechenrelevantes geändert
        if vergleich(db, projekt, basis(projekt, db), neu) is not None:
            betroffen.append(projekt.id)
            continue
        if abgelehnt is not None:
            # Neue Änderung ohne Auswirkung: Die Ablehnung gilt weiter, jetzt bezogen auf den neuen Stand
            projekt.vorgaben_abgelehnt = neu
            aktion, aenderungen = "vorgaben_abgelehnt", {
                "automatisch": True, "grund": f"{GRUND_STILL}; bisherige Ablehnung gilt weiter",
                "unterschiede": unterschiede(abgelehnt, neu),
            }
        else:
            projekt.vorgaben_stand = neu
            projekt.vorgaben_stand_am = jetzt
            aktion, aenderungen = "vorgaben_uebernommen", {
                "automatisch": True, "grund": GRUND_STILL, "unterschiede": liste,
            }
        db.add(Protokoll(
            zeitpunkt=jetzt, benutzer_id=benutzer_id, projekt_id=projekt.id, objektart="Projekt",
            objekt_id=projekt.id, aktion=aktion, aenderungen=aenderungen,
        ))
        still.append(projekt.id)
    db.commit()
    return {"still": still, "betroffen": betroffen}


def projekt_kurz(projekt: Projekt, auswirkung: dict) -> dict:
    return {
        "projekt_id": projekt.id, "nummer": projekt.nummer, "bezeichnung": projekt.bezeichnung,
        "status": projekt.status, "ausgecheckt": projekt.ausgecheckt_am is not None, **auswirkung,
    }


def betroffene(db: Session) -> list[dict]:
    """Sammelansicht: alle Projekte, die auf die Entscheidung des Fachprüfers über neue Vorgaben warten."""
    neu = schnappschuss(db)
    ergebnis = []
    for projekt in _offene_projekte(db):
        if not projekt.vorgaben_offen:
            continue
        auswirkung = vergleich(db, projekt, basis(projekt, db), neu) or {
            "summe_alt_w": 0.0, "summe_neu_w": 0.0, "raeume": [], "neue_verstoesse": 0,
        }
        ergebnis.append({**projekt_kurz(projekt, auswirkung), "unterschiede": len(unterschiede(projekt_stand(db, projekt), neu))})
    return ergebnis


# ── Vorschau vor dem Speichern ──


def stand_mit_aenderung(stand: dict, art: str, ziel: int | str | None, daten: dict) -> dict:
    """Wendet eine geplante Fachvorgaben-Änderung auf eine Kopie des Stands an (nichts wird gespeichert)."""
    neu = copy.deepcopy(stand)
    if art == "werte":
        neu["werte"].update(daten)
    elif art == "raumtyp_aendern":
        for t in neu["raumtypen"]:
            if t["id"] == ziel:
                t.update(daten)
    elif art == "raumtyp_loeschen":
        neu["raumtypen"] = [t for t in neu["raumtypen"] if t["id"] != ziel]
        neu["pauschalen"] = [p for p in neu["pauschalen"] if p["raumtyp_id"] != ziel]
    elif art == "raumtyp_neu":
        neu["raumtypen"].append({"id": -1, "theta_int": None, "luftwechsel": None, "reduktionsfaktor": None,
                                 "quelle": "", "bemerkung": "", "reihenfolge": 0, "richtwert_altbau_w_m2": None,
                                 **daten})
    elif art == "pauschale":
        schluessel = (daten["raumtyp_id"], daten["gebaeudestandard"])
        neu["pauschalen"] = [p for p in neu["pauschalen"] if (p["raumtyp_id"], p["gebaeudestandard"]) != schluessel]
        if daten.get("w_m2") is not None:
            neu["pauschalen"].append({"raumtyp_id": daten["raumtyp_id"], "gebaeudestandard": daten["gebaeudestandard"],
                                      "w_m2": daten["w_m2"], "quelle": daten.get("quelle", "")})
    elif art == "regel":
        for r in neu.get("regeln", []):
            if r["schluessel"] == ziel:
                r.update({k: ("" if v is None and k != "wert" else v) for k, v in daten.items()})
    return neu


def vorschau(db: Session, art: str, ziel: int | str | None, daten: dict) -> dict:
    """Welche Projekte eine geplante Änderung beträfe (Wirkung genau dieser Änderung auf die aktuellen Vorgaben)."""
    vorher = schnappschuss(db)
    nachher = stand_mit_aenderung(vorher, art, ziel, daten)
    if not unterschiede(vorher, nachher):
        return {"betroffen": [], "geprueft": 0}
    projekte = _offene_projekte(db)
    betroffen = [
        projekt_kurz(p, a) for p in projekte if (a := vergleich(db, p, vorher, nachher)) is not None
    ]
    return {"betroffen": betroffen, "geprueft": len(projekte)}
