"""Räume aus Rechtecken: Spalte raum.geometrie (Paket M2, 02.11.2026)

Bestehende Räume mit Länge und Breite erhalten {basis: {w: Länge, h: Breite}, teile: []} – sie bleiben Rechtecke,
Fläche und alle übrigen Werte unverändert. Räume ohne Maße bleiben ohne Geometrie.

Revision ID: d5e2a8c41f93
Revises: c3a9e7f15b42
Create Date: 2026-11-02 09:00:00
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'd5e2a8c41f93'
down_revision = 'c3a9e7f15b42'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('raum', sa.Column('geometrie', postgresql.JSONB(), nullable=True))
    op.execute(
        "UPDATE raum SET geometrie = jsonb_build_object('basis', jsonb_build_object('w', laenge_m, 'h', breite_m), 'teile', '[]'::jsonb) "
        "WHERE laenge_m IS NOT NULL AND breite_m IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column('raum', 'geometrie')
