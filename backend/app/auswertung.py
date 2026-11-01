"""Auswertung eines Objekts (Gebäudes) über alle Heizlastquellen.

Das Backend stellt den vollständigen Planungsstand zusammen (Objekt, Räume, Bauteile und die im Projekt
eingefrorenen Fachvorgaben, app/vorgabenstand.py);
die Auflösung der Vorgaben mit Herkunft und die Rechnung übernimmt der Rechenkern (art "objekt").
Derselbe Code rechnet offline im Browser – Server und Tablet kommen so zum selben Ergebnis.
"""
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BibBauteil, Fachvorgaben, Objekt
from app.rechenkern_bruecke import rechenkern_aufrufen
from app.schemas import GEBAEUDESTANDARD_TEXT
from app.vorgabenstand import schnappschuss
RAUM_FELDER = (
    "id", "bezeichnung", "raumtyp_id", "laenge_m", "breite_m", "flaeche_m2", "hoehe_m", "volumen_m3",
    "heizlastquelle", "hottgenroth_w", "pauschale_w_m2", "theta_int", "luftwechsel", "sperrflaechen", "module",
)
FLAECHE_FELDER = (
    "id", "bezeichnung", "bauteil_id", "u_wert", "flaeche_brutto_m2", "angrenzung", "angrenzender_raumtyp_id",
    "theta_angrenzend", "f_korrektur", "delta_u_wb",
)
OEFFNUNG_FELDER = ("id", "bezeichnung", "bauteil_id", "u_wert", "flaeche_m2", "anzahl")


def fachvorgaben_laden(db: Session) -> Fachvorgaben:
    return db.get(Fachvorgaben, 1) or Fachvorgaben(id=1)


def _felder(obj: object, namen: tuple[str, ...]) -> dict:
    return {n: getattr(obj, n) for n in namen}


def objekt_planung(
    db: Session, objekt: Objekt, stand: dict | None = None, module_neu: Callable[[list], list] | None = None
) -> dict:
    """Vollständiger Planungsstand eines Objekts als Rechenkern-Eingabe (art "objekt").

    stand: Fachvorgaben, mit denen gerechnet wird – ohne Angabe die des Projekts (eingefroren).
    module_neu: ersetzt die platzierten Module je Raum (z. B. mit aktuellen Katalogdaten, app/modulabgleich.py).
    """
    stand = stand or objekt.projekt.vorgaben_stand or schnappschuss(db)
    w = stand["werte"]
    return {
        "art": "objekt",
        "objekt": {
            "id": objekt.id, "bezeichnung": objekt.bezeichnung, "gebaeudestandard": objekt.gebaeudestandard,
            "gebaeudestandard_text": GEBAEUDESTANDARD_TEXT[objekt.gebaeudestandard],
            "delta_u_wb": objekt.delta_u_wb,
            "pauschale_abweichungen": objekt.pauschale_abweichungen or {},
            "theta_e": objekt.klimadaten.theta_e if objekt.klimadaten else None,
        },
        "vorgaben": {
            "rueckfall_neubau_w_m2": w.get("rueckfall_neubau_w_m2"),
            "rueckfall_effizienzhaus_sanierung_w_m2": w.get("rueckfall_effizienzhaus_sanierung_w_m2"),
            # bewusst kein Rückfallwert für „sonstiger Bestand“ (Pauschale je Raum Pflicht)
            "rueckfall_sonstiger_bestand_w_m2": None,
            "hoehe_hinweis_m": w.get("hoehe_hinweis_m"),
            "delta_u_wb": w.get("delta_u_wb"),
        },
        "pauschalen": [
            {"raumtyp_id": p["raumtyp_id"], "gebaeudestandard": p["gebaeudestandard"], "w_m2": p["w_m2"]}
            for p in stand["pauschalen"]
        ],
        "raumtypen": [
            {k: t[k] for k in ("id", "bezeichnung", "theta_int", "luftwechsel", "reduktionsfaktor")}
            for t in stand["raumtypen"]
        ],
        "bauteile": [{"id": b.id, "u_wert": b.u_wert} for b in db.scalars(select(BibBauteil).order_by(BibBauteil.id))],
        # Platzierungsregeln im Stand des Projekts (ältere Stände ohne Regeln: alles „Vorgabe fehlt“)
        "regeln": stand.get("regeln", []),
        # Objektbibliothek im Stand des Projekts (ältere Stände ohne Bibliothek: Objekte unbekannt → tabu)
        "objekte": stand.get("objekte", []),
        "geschosse": [
            {
                "id": g.id, "bezeichnung": g.bezeichnung,
                "raeume": [
                    {
                        **_felder(r, RAUM_FELDER),
                        **({"module": module_neu(r.module or [])} if module_neu else {}),
                        "flaechen": [
                            {**_felder(f, FLAECHE_FELDER), "oeffnungen": [_felder(o, OEFFNUNG_FELDER) for o in f.oeffnungen]}
                            for f in r.flaechen
                        ],
                    }
                    for r in g.raeume
                ],
            }
            for g in sorted(objekt.geschosse, key=lambda g: (g.reihenfolge, g.id))
        ],
    }


def objekt_auswerten(
    db: Session, objekt: Objekt, stand: dict | None = None, module_neu: Callable[[list], list] | None = None
) -> tuple[dict, dict]:
    """Gibt (Planungsstand als Rechenkern-Eingabe, Auswertung) zurück."""
    planung = objekt_planung(db, objekt, stand, module_neu)
    return planung, rechenkern_aufrufen(planung)["auswertung"]
