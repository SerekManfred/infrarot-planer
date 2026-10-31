"""Türen und Fenster je Raum als Orientierung im Deckenplan (Festlegung Auftraggeber 31.10.2026)

Keine Sperrflächen, ohne Einfluss auf Platzierung und Regelprüfung.

Revision ID: 3b7e9c4d2a18
Revises: 8d3f6a21c5e9
Create Date: 2026-10-31 14:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '3b7e9c4d2a18'
down_revision = '8d3f6a21c5e9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('raum', sa.Column('tueren_fenster', postgresql.JSONB(astext_type=sa.Text()), server_default='[]',
                                    nullable=False))


def downgrade() -> None:
    op.drop_column('raum', 'tueren_fenster')
