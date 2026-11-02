"""Kalkulation (Paket M4c, 02.11.2026): Recht je Benutzer, Artikelstamm, eingefrorener Preisstand je Projekt

- benutzer.kalkulation_sehen (Standard nein; Admins sehen die Kalkulation immer)
- artikel: Raumthermostat und Elektroanschluss-Pauschale (je Raum mit Modulen), Anfahrt (je Projekt) – ohne Preise
  (Preis fehlt, bis der Admin ihn einträgt; nichts erfunden)
- projekt.preisstand: Preise beim ersten Erzeugen der Kalkulation eingefroren

Revision ID: f1c4d8a92b37
Revises: e7b3c9d2a614
Create Date: 2026-11-02 11:00:00
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'f1c4d8a92b37'
down_revision = 'e7b3c9d2a614'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('benutzer', sa.Column('kalkulation_sehen', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('projekt', sa.Column('preisstand', postgresql.JSONB(), nullable=True))
    tabelle = op.create_table(
        'artikel',
        sa.Column('schluessel', sa.String(50), primary_key=True),
        sa.Column('bezeichnung', sa.String(200), nullable=False),
        sa.Column('einheit', sa.String(30), nullable=False, server_default='Stück'),
        sa.Column('bezug', sa.String(20), nullable=False, server_default='raum'),
        sa.Column('art_nr', sa.String(50), nullable=False, server_default=''),
        sa.Column('ek_netto', sa.Float(), nullable=True, comment='€'),
        sa.Column('vk_netto', sa.Float(), nullable=True, comment='€'),
        sa.Column('reihenfolge', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('erstellt_am', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('geaendert_am', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.bulk_insert(tabelle, [
        {"schluessel": "raumthermostat", "bezeichnung": "Raumthermostat", "einheit": "Stück", "bezug": "raum", "art_nr": "", "reihenfolge": 1},
        {"schluessel": "elektroanschluss", "bezeichnung": "Elektroanschluss-Pauschale", "einheit": "Pauschale", "bezug": "raum", "art_nr": "", "reihenfolge": 2},
        {"schluessel": "anfahrt", "bezeichnung": "Anfahrt", "einheit": "Pauschale", "bezug": "projekt", "art_nr": "", "reihenfolge": 3},
    ])


def downgrade() -> None:
    op.drop_table('artikel')
    op.drop_column('projekt', 'preisstand')
    op.drop_column('benutzer', 'kalkulation_sehen')
