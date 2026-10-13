"""Fachvorgaben je Projekt bewusst ablehnen (Festlegung Auftraggeber 13.10.2026)

Der Fachprüfer kann neue zentrale Fachvorgaben für ein Projekt übernehmen oder bewusst ablehnen. Gespeichert wird
der abgelehnte zentrale Stand; ändert sich zentral danach wieder etwas, ist die Entscheidung erneut offen.

Revision ID: 5e8b1c90d4a7
Revises: a4d2c8e61f07
Create Date: 2026-10-13 14:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '5e8b1c90d4a7'
down_revision = 'a4d2c8e61f07'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('projekt', sa.Column('vorgaben_abgelehnt', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('projekt', sa.Column('vorgaben_abgelehnt_am', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('projekt', 'vorgaben_abgelehnt_am')
    op.drop_column('projekt', 'vorgaben_abgelehnt')
