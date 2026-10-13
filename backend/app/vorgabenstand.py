"""Eingefrorene Fachvorgaben je Projekt (Festlegung Auftraggeber 12.10.2026).

Beim Anlegen speichert das Projekt eine Kopie der gültigen zentralen Fachvorgaben (Einzelwerte, Raumtypen mit
Kennwerten, Pauschalen) und rechnet nur damit. Ändern sich die zentralen Vorgaben, zeigt das Projekt die
Unterschiede; übernommen wird nur per bewusstem Klick (protokolliert). Freigegebene Projekte bleiben unverändert.

Festlegung 13.10.2026: Übernehmen oder bewusst ablehnen darf nur der Fachprüfer. Bis dahin sind die Vorgaben
„offen“ und für das Projekt ist kein Angebot möglich. Abgelehnt wird ein bestimmter zentraler Stand; kommt danach
zentral etwas Neues hinzu, ist die Entscheidung wieder offen.

Die Bibliotheken (Bauteile mit U-Werten, Klimadaten) gehören nicht dazu – sie sind Nachschlagewerke mit Quellenangabe
und werden über ihre ID verwendet.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BibRaumtyp, Fachvorgaben, HeizlastPauschale, Projekt
from app.schemas import GEBAEUDESTANDARD_TEXT

WERTE = ("rueckfall_neubau_w_m2", "rueckfall_effizienzhaus_sanierung_w_m2", "hoehe_hinweis_m", "delta_u_wb", "quelle")
RAUMTYP_FELDER = ("id", "bezeichnung", "theta_int", "luftwechsel", "reduktionsfaktor", "quelle", "bemerkung", "reihenfolge")

WERTE_TEXT = {
    "rueckfall_neubau_w_m2": "Rückfallwert Neubau (W/m²)",
    "rueckfall_effizienzhaus_sanierung_w_m2": "Rückfallwert Effizienzhaus-Sanierung (W/m²)",
    "hoehe_hinweis_m": "Raumhöhe für den Hinweis zur Pauschale (m)",
    "delta_u_wb": "Wärmebrückenzuschlag ΔU_WB (W/(m²·K))",
}
RAUMTYP_TEXT = {
    "bezeichnung": "Bezeichnung",
    "theta_int": "Norm-Innentemperatur (°C)",
    "luftwechsel": "Luftwechsel (1/h)",
    "reduktionsfaktor": "Reduktionsfaktor",
}


def schnappschuss(db: Session) -> dict:
    """Aktuelle zentrale Fachvorgaben als Kopie für ein Projekt (Aufbau wie GET /api/fachvorgaben, ohne Texte)."""
    v = db.get(Fachvorgaben, 1) or Fachvorgaben(id=1)
    return {
        "werte": {n: getattr(v, n) for n in WERTE},
        "raumtypen": [
            {n: getattr(t, n) for n in RAUMTYP_FELDER}
            for t in db.scalars(select(BibRaumtyp).order_by(BibRaumtyp.reihenfolge, BibRaumtyp.bezeichnung))
        ],
        "pauschalen": [
            {"raumtyp_id": p.raumtyp_id, "gebaeudestandard": p.gebaeudestandard, "w_m2": p.w_m2, "quelle": p.quelle}
            for p in db.scalars(select(HeizlastPauschale).order_by(HeizlastPauschale.raumtyp_id, HeizlastPauschale.gebaeudestandard))
        ],
    }


def projekt_stand(db: Session, projekt: Projekt) -> dict:
    """Fachvorgaben, mit denen das Projekt rechnet (ältere Projekte ohne Kopie: aktueller zentraler Stand)."""
    return projekt.vorgaben_stand or schnappschuss(db)


def offene_unterschiede(db: Session, projekt: Projekt, neu: dict | None = None) -> list[dict]:
    """Unterschiede zum zentralen Stand, über die der Fachprüfer noch nicht entschieden hat (leer = nichts offen)."""
    neu = neu if neu is not None else schnappschuss(db)
    liste = unterschiede(projekt_stand(db, projekt), neu)
    if liste and projekt.vorgaben_abgelehnt is not None and not unterschiede(projekt.vorgaben_abgelehnt, neu):
        return []
    return liste


def mit_texten(stand: dict) -> dict:
    """Für die Oberfläche: wie GET /api/fachvorgaben (mit Texten der Gebäudestandards)."""
    return {**stand, "gebaeudestandards": GEBAEUDESTANDARD_TEXT}


def unterschiede(alt: dict, neu: dict) -> list[dict]:
    """Was sich zentral gegenüber dem Projektstand geändert hat (nur rechenrelevante Werte, Quellen nicht)."""
    ergebnis: list[dict] = []

    def neu_eintrag(bereich: str, bezeichnung: str, a, n) -> None:
        ergebnis.append({"bereich": bereich, "bezeichnung": bezeichnung, "alt": a, "neu": n})

    for feld, text in WERTE_TEXT.items():
        a, n = alt["werte"].get(feld), neu["werte"].get(feld)
        if a != n:
            neu_eintrag("Einzelwert", text, a, n)

    typen_alt = {t["id"]: t for t in alt["raumtypen"]}
    typen_neu = {t["id"]: t for t in neu["raumtypen"]}
    for tid, t in typen_neu.items():
        if tid not in typen_alt:
            neu_eintrag("Raumtyp", f"{t['bezeichnung']}", None, "neu")
            continue
        for feld, text in RAUMTYP_TEXT.items():
            if typen_alt[tid].get(feld) != t.get(feld):
                neu_eintrag("Raumtyp", f"{typen_alt[tid]['bezeichnung']}: {text}", typen_alt[tid].get(feld), t.get(feld))
    for tid, t in typen_alt.items():
        if tid not in typen_neu:
            neu_eintrag("Raumtyp", f"{t['bezeichnung']}", "vorhanden", "entfernt")

    namen = {**{t["id"]: t["bezeichnung"] for t in alt["raumtypen"]}, **{t["id"]: t["bezeichnung"] for t in neu["raumtypen"]}}
    p_alt = {(p["raumtyp_id"], p["gebaeudestandard"]): p["w_m2"] for p in alt["pauschalen"]}
    p_neu = {(p["raumtyp_id"], p["gebaeudestandard"]): p["w_m2"] for p in neu["pauschalen"]}
    for schluessel in sorted(p_alt.keys() | p_neu.keys(), key=lambda k: (namen.get(k[0], ""), k[1])):
        a, n = p_alt.get(schluessel), p_neu.get(schluessel)
        if a != n:
            raumtyp, standard = schluessel
            neu_eintrag(
                "Pauschale", f"{namen.get(raumtyp, f'Raumtyp {raumtyp}')} / {GEBAEUDESTANDARD_TEXT[standard]} (W/m²)", a, n
            )
    return ergebnis
