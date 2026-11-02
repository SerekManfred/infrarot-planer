"""Firmendaten (Paket M3, 02.11.2026): Tabelle firma, projekt.berichtsfirma_id

Angelegt werden die beiden genannten Firmen nur mit Namen (Anschrift, Logo usw. pflegt der Admin; nichts erfunden):
„Mein Energie Haus GmbH“ als Standard für Berichte, „Energieeffizienzberatung Manfred Serek GmbH“.

Revision ID: e7b3c9d2a614
Revises: d5e2a8c41f93
Create Date: 2026-11-02 10:00:00
"""
import sqlalchemy as sa
from alembic import op

revision = 'e7b3c9d2a614'
down_revision = 'd5e2a8c41f93'
branch_labels = None
depends_on = None

FELDER = ("rechtsform", "strasse", "plz", "ort", "telefon", "email", "web", "geschaeftsfuehrer", "handelsregister", "ust_idnr")
LAENGEN = {"rechtsform": 100, "strasse": 200, "plz": 10, "ort": 200, "telefon": 100, "email": 254, "web": 200,
           "geschaeftsfuehrer": 300, "handelsregister": 200, "ust_idnr": 50}


def upgrade() -> None:
    op.create_table(
        'firma',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False, unique=True),
        *[sa.Column(f, sa.String(LAENGEN[f]), nullable=False, server_default='') for f in FELDER],
        sa.Column('logo_datei', sa.String(100), nullable=True),
        sa.Column('standard', sa.Boolean(), nullable=False, server_default=sa.false(), comment='Standardfirma für Berichte'),
        sa.Column('erstellt_am', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('geaendert_am', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column('projekt', sa.Column('berichtsfirma_id', sa.Integer(), sa.ForeignKey('firma.id', ondelete='SET NULL'), nullable=True))
    op.execute("INSERT INTO firma (name, standard) VALUES ('Mein Energie Haus GmbH', true), ('Energieeffizienzberatung Manfred Serek GmbH', false)")


def downgrade() -> None:
    op.drop_column('projekt', 'berichtsfirma_id')
    op.drop_table('firma')
