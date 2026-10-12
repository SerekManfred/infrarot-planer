"""Phase 1D: kombinierbare Rollen, eingefrorene Fachvorgaben je Projekt, kein Höhenzuschlag

Festlegungen Auftraggeber 12.10.2026:
- Rollen kombinierbar (benutzer.rolle → benutzer.rollen als Liste)
- kein Höhenzuschlag: Grenzhöhe wird zur Hinweis-Höhe, Zuschlag und Projekt-Abweichungen entfallen
- kein Rückfallwert für „sonstiger Bestand“ (Pauschale je Raum Pflicht)
- Projekt speichert eine Kopie der Fachvorgaben (vorgaben_stand); vorhandene Projekte erhalten den aktuellen Stand

Revision ID: a4d2c8e61f07
Revises: 7c1e5a9d3b42
Create Date: 2026-10-12 19:00:00
"""
import json
from datetime import UTC, datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'a4d2c8e61f07'
down_revision = '7c1e5a9d3b42'
branch_labels = None
depends_on = None


def _schnappschuss(verbindung) -> dict:
    """Wie app/vorgabenstand.schnappschuss – hier eigenständig, damit die Migration nicht vom App-Code abhängt."""
    w = verbindung.execute(sa.text(
        "SELECT rueckfall_neubau_w_m2, rueckfall_effizienzhaus_sanierung_w_m2, hoehe_hinweis_m, delta_u_wb, quelle "
        "FROM fachvorgaben WHERE id = 1"
    )).mappings().first()
    raumtypen = verbindung.execute(sa.text(
        "SELECT id, bezeichnung, theta_int, luftwechsel, reduktionsfaktor, quelle, bemerkung, reihenfolge "
        "FROM bib_raumtyp ORDER BY reihenfolge, bezeichnung"
    )).mappings().all()
    pauschalen = verbindung.execute(sa.text(
        "SELECT raumtyp_id, gebaeudestandard, w_m2, quelle FROM heizlast_pauschale ORDER BY raumtyp_id, gebaeudestandard"
    )).mappings().all()
    leer = {"rueckfall_neubau_w_m2": None, "rueckfall_effizienzhaus_sanierung_w_m2": None, "hoehe_hinweis_m": None,
            "delta_u_wb": None, "quelle": ""}
    return {
        "werte": dict(w) if w else leer,
        "raumtypen": [dict(t) for t in raumtypen],
        "pauschalen": [dict(p) for p in pauschalen],
    }


def upgrade() -> None:
    # Rollen
    op.add_column('benutzer', sa.Column('rollen', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.execute("UPDATE benutzer SET rollen = jsonb_build_array(rolle)")
    op.alter_column('benutzer', 'rollen', nullable=False)
    op.drop_constraint('ck_benutzer_rolle', 'benutzer', type_='check')
    op.drop_column('benutzer', 'rolle')

    # Kein Höhenzuschlag, kein Rückfallwert „sonstiger Bestand“
    op.alter_column('fachvorgaben', 'hoehenzuschlag_grenzhoehe_m', new_column_name='hoehe_hinweis_m',
                    comment='Raumhöhe in m, ab der ein Hinweis erscheint')
    op.drop_column('fachvorgaben', 'hoehenzuschlag_prozent_je_m')
    op.drop_column('fachvorgaben', 'rueckfall_sonstiger_bestand_w_m2')
    op.drop_column('objekt', 'hoehenzuschlag_grenzhoehe_m')
    op.drop_column('objekt', 'hoehenzuschlag_prozent_je_m')

    # Eingefrorene Fachvorgaben je Projekt
    op.add_column('projekt', sa.Column('vorgaben_stand', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('projekt', sa.Column('vorgaben_stand_am', sa.DateTime(timezone=True), nullable=True))
    verbindung = op.get_bind()
    if verbindung.execute(sa.text("SELECT count(*) FROM projekt")).scalar():
        stand = json.dumps(_schnappschuss(verbindung))
        verbindung.execute(
            sa.text("UPDATE projekt SET vorgaben_stand = CAST(:stand AS jsonb), vorgaben_stand_am = :jetzt"),
            {"stand": stand, "jetzt": datetime.now(UTC)},
        )


def downgrade() -> None:
    op.drop_column('projekt', 'vorgaben_stand_am')
    op.drop_column('projekt', 'vorgaben_stand')
    op.add_column('objekt', sa.Column('hoehenzuschlag_prozent_je_m', sa.Float(), nullable=True))
    op.add_column('objekt', sa.Column('hoehenzuschlag_grenzhoehe_m', sa.Float(), nullable=True))
    op.add_column('fachvorgaben', sa.Column('rueckfall_sonstiger_bestand_w_m2', sa.Float(), nullable=True))
    op.add_column('fachvorgaben', sa.Column('hoehenzuschlag_prozent_je_m', sa.Float(), nullable=True))
    op.alter_column('fachvorgaben', 'hoehe_hinweis_m', new_column_name='hoehenzuschlag_grenzhoehe_m', comment=None)
    op.add_column('benutzer', sa.Column('rolle', sa.String(length=20), nullable=True))
    # Bei kombinierten Rollen gewinnt die stärkste
    op.execute(
        "UPDATE benutzer SET rolle = CASE WHEN rollen ? 'admin' THEN 'admin' "
        "WHEN rollen ? 'fachpruefer' THEN 'fachpruefer' ELSE 'aussendienst' END"
    )
    op.alter_column('benutzer', 'rolle', nullable=False)
    op.create_check_constraint('ck_benutzer_rolle', 'benutzer', "rolle IN ('admin', 'fachpruefer', 'aussendienst')")
    op.drop_column('benutzer', 'rollen')
