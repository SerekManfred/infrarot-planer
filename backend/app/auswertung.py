"""Auswertung eines Objekts (Gebäudes) über alle Heizlastquellen.

Das Backend stellt den vollständigen Planungsstand zusammen (Objekt, Räume, Bauteile, Fachvorgaben);
die Auflösung der Vorgaben mit Herkunft und die Rechnung übernimmt der Rechenkern (art "objekt").
Derselbe Code rechnet offline im Browser – Server und Tablet kommen so zum selben Ergebnis.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BibBauteil, BibRaumtyp, Fachvorgaben, HeizlastPauschale, Objekt
from app.rechenkern_bruecke import rechenkern_aufrufen
from app.schemas import GEBAEUDESTANDARD_TEXT

VORGABEN_FELDER = (
    "rueckfall_neubau_w_m2", "rueckfall_effizienzhaus_sanierung_w_m2", "rueckfall_sonstiger_bestand_w_m2",
    "hoehenzuschlag_grenzhoehe_m", "hoehenzuschlag_prozent_je_m", "delta_u_wb",
)
RAUM_FELDER = (
    "id", "bezeichnung", "raumtyp_id", "laenge_m", "breite_m", "flaeche_m2", "hoehe_m", "volumen_m3",
    "heizlastquelle", "hottgenroth_w", "pauschale_w_m2", "theta_int", "luftwechsel",
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


def objekt_planung(db: Session, objekt: Objekt) -> dict:
    """Vollständiger Planungsstand eines Objekts als Rechenkern-Eingabe (art "objekt")."""
    v = fachvorgaben_laden(db)
    return {
        "art": "objekt",
        "objekt": {
            "id": objekt.id, "bezeichnung": objekt.bezeichnung, "gebaeudestandard": objekt.gebaeudestandard,
            "gebaeudestandard_text": GEBAEUDESTANDARD_TEXT[objekt.gebaeudestandard],
            "delta_u_wb": objekt.delta_u_wb,
            "hoehenzuschlag_grenzhoehe_m": objekt.hoehenzuschlag_grenzhoehe_m,
            "hoehenzuschlag_prozent_je_m": objekt.hoehenzuschlag_prozent_je_m,
            "pauschale_abweichungen": objekt.pauschale_abweichungen or {},
            "theta_e": objekt.klimadaten.theta_e if objekt.klimadaten else None,
        },
        "vorgaben": _felder(v, VORGABEN_FELDER),
        "pauschalen": [
            {"raumtyp_id": p.raumtyp_id, "gebaeudestandard": p.gebaeudestandard, "w_m2": p.w_m2}
            for p in db.scalars(select(HeizlastPauschale).order_by(HeizlastPauschale.id))
        ],
        "raumtypen": [
            _felder(t, ("id", "bezeichnung", "theta_int", "luftwechsel", "reduktionsfaktor"))
            for t in db.scalars(select(BibRaumtyp).order_by(BibRaumtyp.id))
        ],
        "bauteile": [{"id": b.id, "u_wert": b.u_wert} for b in db.scalars(select(BibBauteil).order_by(BibBauteil.id))],
        "geschosse": [
            {
                "id": g.id, "bezeichnung": g.bezeichnung,
                "raeume": [
                    {
                        **_felder(r, RAUM_FELDER),
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


def objekt_auswerten(db: Session, objekt: Objekt) -> tuple[dict, dict]:
    """Gibt (Planungsstand als Rechenkern-Eingabe, Auswertung) zurück."""
    planung = objekt_planung(db, objekt)
    return planung, rechenkern_aufrufen(planung)["auswertung"]
