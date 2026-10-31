"""Projekt einem Außendienst-Benutzer zuweisen (Festlegung Auftraggeber 31.10.2026)

Benutzer mit nur der Rolle Außendienst sehen nur Projekte, die sie angelegt haben oder die ihnen zugewiesen sind.

Revision ID: 6c2a8f1e7d45
Revises: 3b7e9c4d2a18
Create Date: 2026-10-31 17:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = '6c2a8f1e7d45'
down_revision = '3b7e9c4d2a18'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('projekt', sa.Column('zugewiesen_an_id', sa.Integer(), nullable=True))
    op.create_foreign_key('projekt_zugewiesen_an_id_fkey', 'projekt', 'benutzer', ['zugewiesen_an_id'], ['id'],
                          ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('projekt_zugewiesen_an_id_fkey', 'projekt', type_='foreignkey')
    op.drop_column('projekt', 'zugewiesen_an_id')
