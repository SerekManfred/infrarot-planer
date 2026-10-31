"""Moduldaten je Projekt bewusst ablehnen (Festlegung Auftraggeber 31.10.2026)

Revision ID: 9e4b2d7c1a63
Revises: 6c2a8f1e7d45
Create Date: 2026-10-31 18:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '9e4b2d7c1a63'
down_revision = '6c2a8f1e7d45'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('projekt', sa.Column('module_abgelehnt', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('projekt', 'module_abgelehnt')
