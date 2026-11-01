"""Objektbibliothek ersetzt die festen Sperrflächen-Typen (Festlegung 01.11.2026)

- neue Tabelle bib_objekt mit der Startausstattung (app/objektbibliothek.py); Objekte, die es schon als
  Sperrflächen-Typ gab, übernehmen Abstand, Höhe und Quelle aus den bisherigen Platzierungsregeln
- die bisherigen Regeln je Sperrflächen-Typ (Abstände, Höhen, „Bett als Sperrfläche“) entfallen
- eingefrorene Projektstände (auch bewusst abgelehnte): Objektbibliothek mit den Werten des jeweiligen Stands ergänzt,
  abgelöste Regeln entfernt – so entsteht durch die Umstellung kein offener Unterschied
- Sperrflächen in allen Räumen: „typ“ → „objekt“ (gleicher Schlüssel; Dusche/Wanne → Dusche, Leuchte/Spot → Leuchte);
  Maße und Positionen bleiben unverändert. Gespeicherte Berechnungen bleiben unverändert.

Revision ID: b7d1e5a3c2f8
Revises: 4f8a1b3c9d27
Create Date: 2026-11-01 17:00:00
"""
import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.objektbibliothek import ABGELOESTE_REGELN, FRUEHERE_REGELN, QUELLE_NEU, START

revision = 'b7d1e5a3c2f8'
down_revision = '4f8a1b3c9d27'
branch_labels = None
depends_on = None

FELDER = (
    "schluessel", "name", "gruppe", "raumtyp_ids", "form", "breite_m", "tiefe_m", "hoehe_m", "kategorie", "abstand_cm",
    "quelle", "aktiv", "reihenfolge",
)


def _objekte(regeln: dict[str, dict], raumtyp_ids: dict[str, int]) -> list[dict]:
    """Startausstattung; frühere Typen mit Abstand, Höhe und Quelle aus den gegebenen Regeln."""
    liste = []
    for i, o in enumerate(START, start=1):
        eintrag = {
            "schluessel": o.schluessel, "name": o.name, "gruppe": o.gruppe,
            "raumtyp_ids": sorted(raumtyp_ids[n] for n in o.raumtypen if n in raumtyp_ids),
            "form": o.form, "breite_m": o.breite_m, "tiefe_m": o.tiefe_m, "hoehe_m": o.hoehe_m,
            "kategorie": o.kategorie, "abstand_cm": o.abstand_cm, "quelle": QUELLE_NEU, "aktiv": True, "reihenfolge": i,
        }
        if o.schluessel in FRUEHERE_REGELN:
            abstand_s, hoehe_s = FRUEHERE_REGELN[o.schluessel]
            teile = []
            if abstand_s in regeln:
                eintrag["abstand_cm"] = regeln[abstand_s].get("wert")
                if regeln[abstand_s].get("quelle"):
                    teile.append(f"Abstand: {regeln[abstand_s]['quelle']}")
            if hoehe_s and hoehe_s in regeln:
                eintrag["hoehe_m"] = regeln[hoehe_s].get("wert")
                if regeln[hoehe_s].get("quelle"):
                    teile.append(f"Höhe: {regeln[hoehe_s]['quelle']}")
            teile.append(f"Maße, Kategorie: {QUELLE_NEU}")
            eintrag["quelle"] = "; ".join(teile)
        liste.append(eintrag)
    return liste


def _stand_umstellen(stand: dict | None, raumtyp_ids: dict[str, int]) -> dict | None:
    if not stand or "objekte" in stand:
        return stand
    regeln = {r["schluessel"]: r for r in stand.get("regeln", [])}
    return {
        **stand,
        "regeln": [r for r in stand.get("regeln", []) if r["schluessel"] not in ABGELOESTE_REGELN],
        "objekte": _objekte(regeln, raumtyp_ids),
    }


def upgrade() -> None:
    op.create_table(
        'bib_objekt',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('schluessel', sa.String(50), nullable=False, comment='stabil, wird in Projekten gespeichert'),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('gruppe', sa.String(20), nullable=False),
        sa.Column('raumtyp_ids', postgresql.JSONB(), nullable=False, comment='passende Raumtypen; leer = alle'),
        sa.Column('form', sa.String(20), nullable=False),
        sa.Column('breite_m', sa.Float(), nullable=True, comment='Standardbreite; Streifen: Tiefe ab der Wand'),
        sa.Column('tiefe_m', sa.Float(), nullable=True),
        sa.Column('hoehe_m', sa.Float(), nullable=True, comment='Höhe der Oberseite (Wärmeverteilung)'),
        sa.Column('kategorie', sa.String(20), nullable=False),
        sa.Column('abstand_cm', sa.Float(), nullable=True, comment='Mindestabstand; leer = Vorgabe fehlt'),
        sa.Column('quelle', sa.String(500), nullable=False),
        sa.Column('aktiv', sa.Boolean(), nullable=False, comment='inaktive Objekte erscheinen nicht mehr in der Auswahl'),
        sa.Column('reihenfolge', sa.Integer(), nullable=False),
        sa.Column('erstellt_am', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('geaendert_am', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('schluessel', name='uq_bib_objekt_schluessel'),
        sa.UniqueConstraint('name', name='uq_bib_objekt_name'),
        sa.CheckConstraint("gruppe IN ('moebel', 'decke', 'baulich')", name='ck_bib_objekt_gruppe'),
        sa.CheckConstraint("form IN ('rechteck', 'punkt', 'streifen')", name='ck_bib_objekt_form'),
        sa.CheckConstraint("kategorie IN ('tabu', 'abstand', 'neutral')", name='ck_bib_objekt_kategorie'),
    )
    conn = op.get_bind()
    raumtyp_ids = {name: rid for rid, name in conn.execute(sa.text("SELECT id, bezeichnung FROM bib_raumtyp"))}
    regeln = {
        s: {"wert": w, "quelle": q}
        for s, w, q in conn.execute(sa.text("SELECT schluessel, wert, quelle FROM platzierungsregel"))
    }
    for o in _objekte(regeln, raumtyp_ids):
        conn.execute(
            sa.text(
                "INSERT INTO bib_objekt (schluessel, name, gruppe, raumtyp_ids, form, breite_m, tiefe_m, hoehe_m, "
                "kategorie, abstand_cm, quelle, aktiv, reihenfolge) VALUES (:schluessel, :name, :gruppe, "
                "CAST(:raumtyp_ids AS jsonb), :form, :breite_m, :tiefe_m, :hoehe_m, :kategorie, :abstand_cm, :quelle, "
                ":aktiv, :reihenfolge)"
            ),
            {**o, "raumtyp_ids": json.dumps(o["raumtyp_ids"])},
        )

    for pid, stand, abgelehnt in conn.execute(sa.text("SELECT id, vorgaben_stand, vorgaben_abgelehnt FROM projekt")).all():
        conn.execute(
            sa.text("UPDATE projekt SET vorgaben_stand = CAST(:s AS jsonb), vorgaben_abgelehnt = CAST(:a AS jsonb) WHERE id = :id"),
            {
                "id": pid,
                "s": json.dumps(_stand_umstellen(stand, raumtyp_ids)) if stand is not None else None,
                "a": json.dumps(_stand_umstellen(abgelehnt, raumtyp_ids)) if abgelehnt is not None else None,
            },
        )

    for rid, sperr in conn.execute(sa.text("SELECT id, sperrflaechen FROM raum WHERE sperrflaechen IS NOT NULL")).all():
        if not sperr:
            continue
        neu = []
        for s in sperr:
            s = dict(s)
            if "objekt" not in s:
                s["objekt"] = s.pop("typ", "sonstiges")
            s.pop("typ", None)
            neu.append(s)
        conn.execute(sa.text("UPDATE raum SET sperrflaechen = CAST(:s AS jsonb) WHERE id = :id"), {"id": rid, "s": json.dumps(neu)})

    conn.execute(
        sa.text("DELETE FROM platzierungsregel WHERE schluessel = ANY(:s)"), {"s": list(ABGELOESTE_REGELN)}
    )


def downgrade() -> None:
    """Zurück zu festen Typen: Objekte ohne früheren Typ werden „sonstiges“; Regeln aus der Bibliothek zurückgeschrieben."""
    conn = op.get_bind()
    objekte = {
        s: (a, h, q) for s, a, h, q in conn.execute(sa.text("SELECT schluessel, abstand_cm, hoehe_m, quelle FROM bib_objekt"))
    }
    for i, (typ, (abstand_s, hoehe_s)) in enumerate(FRUEHERE_REGELN.items()):
        a, h, q = objekte.get(typ, (None, None, ""))
        for schluessel, wert, einheit in ((abstand_s, a, "cm"), (hoehe_s, h, "m")):
            if schluessel:
                conn.execute(
                    sa.text(
                        "INSERT INTO platzierungsregel (schluessel, bezeichnung, wert, wert_text, einheit, erlaeuterung, "
                        "quelle, reihenfolge) VALUES (:s, :s, :w, '', :e, '', :q, :r) ON CONFLICT (schluessel) DO NOTHING"
                    ),
                    {"s": schluessel, "w": wert, "e": einheit, "q": q[:500], "r": 100 + i},
                )
    for rid, sperr in conn.execute(sa.text("SELECT id, sperrflaechen FROM raum WHERE sperrflaechen IS NOT NULL")).all():
        if not sperr:
            continue
        neu = []
        for s in sperr:
            s = dict(s)
            objekt = s.pop("objekt", None) or "sonstiges"
            s["typ"] = objekt if objekt in FRUEHERE_REGELN else ("leuchte" if objekt == "spot" else "sonstiges")
            neu.append(s)
        conn.execute(sa.text("UPDATE raum SET sperrflaechen = CAST(:s AS jsonb) WHERE id = :id"), {"id": rid, "s": json.dumps(neu)})
    for pid, stand in conn.execute(sa.text("SELECT id, vorgaben_stand FROM projekt WHERE vorgaben_stand IS NOT NULL")).all():
        stand = {k: v for k, v in stand.items() if k != "objekte"}
        conn.execute(sa.text("UPDATE projekt SET vorgaben_stand = CAST(:s AS jsonb) WHERE id = :id"), {"id": pid, "s": json.dumps(stand)})
    op.drop_table('bib_objekt')
