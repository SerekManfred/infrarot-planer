"""Emissionsgrad: Einheit der Vorgabe-Regel verständlich beschriftet (Paket K, 01.11.2026)

Nur die Anzeige der Einheit („0–1, ohne Einheit“ statt „–“); Werte und Projektstände bleiben unverändert
(die Einheit zählt beim Vergleich mit den Projektständen nicht).

Revision ID: c3a9e7f15b42
Revises: b7d1e5a3c2f8
Create Date: 2026-11-01 18:00:00
"""
from alembic import op

revision = 'c3a9e7f15b42'
down_revision = 'b7d1e5a3c2f8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE platzierungsregel SET einheit = '0–1, ohne Einheit' WHERE schluessel = 'strahler_emissionsgrad'")


def downgrade() -> None:
    op.execute("UPDATE platzierungsregel SET einheit = '–' WHERE schluessel = 'strahler_emissionsgrad'")
