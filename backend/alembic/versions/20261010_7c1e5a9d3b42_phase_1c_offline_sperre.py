"""Phase 1C Offline-Sperre am Projekt

Revision ID: 7c1e5a9d3b42
Revises: 2f7f639cc127
Create Date: 2026-10-10 10:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = '7c1e5a9d3b42'
down_revision = '2f7f639cc127'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('projekt', sa.Column('ausgecheckt_von_id', sa.Integer(), nullable=True))
    op.add_column('projekt', sa.Column('ausgecheckt_geraet', sa.String(length=100), nullable=True))
    op.add_column('projekt', sa.Column('ausgecheckt_am', sa.DateTime(timezone=True), nullable=True))
    op.add_column('projekt', sa.Column('sperre_hash', sa.String(length=64), nullable=True))
    op.create_foreign_key(
        'projekt_ausgecheckt_von_id_fkey', 'projekt', 'benutzer', ['ausgecheckt_von_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('projekt_ausgecheckt_von_id_fkey', 'projekt', type_='foreignkey')
    op.drop_column('projekt', 'sperre_hash')
    op.drop_column('projekt', 'ausgecheckt_am')
    op.drop_column('projekt', 'ausgecheckt_geraet')
    op.drop_column('projekt', 'ausgecheckt_von_id')
