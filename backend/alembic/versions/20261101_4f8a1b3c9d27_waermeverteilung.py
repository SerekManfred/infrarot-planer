"""Wärmeverteilung: Strahlerkennwerte im Modulkatalog, Höhen je Sperrflächen-Typ und Vorgabewerte (Festlegung 01.11.2026)

- bib_modul: Oberflächentemperatur, Emissionsgrad, Abstrahlwinkel (leer = Vorgabewert)
- platzierungsregel: Höhen je Sperrflächen-Typ mit den Werten des Auftraggebers; Vorgabewerte für Oberflächen-
  temperatur, Emissionsgrad und Abstrahlwinkel bewusst leer („Vorgabe fehlt“, werden nicht geschätzt)

Revision ID: 4f8a1b3c9d27
Revises: 9e4b2d7c1a63
Create Date: 2026-11-01 10:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = '4f8a1b3c9d27'
down_revision = '9e4b2d7c1a63'
branch_labels = None
depends_on = None

QUELLE = "Festlegung Auftraggeber 01.11.2026"
REGELN = [
    ("hoehe_sitzplatz_m", "Höhe Sitzplatz (Wärmeverteilung)", "m", 0.45, QUELLE),
    ("hoehe_bett_m", "Höhe Bett (Wärmeverteilung)", "m", 0.50, QUELLE),
    ("hoehe_hochschrank_m", "Höhe Hochschrank (Wärmeverteilung)", "m", 2.00, QUELLE),
    ("hoehe_dusche_m", "Höhe Dusche/Wanne (Wärmeverteilung)", "m", 0.0, QUELLE),
    ("hoehe_sonstiges_m", "Höhe sonstige Sperrfläche (Wärmeverteilung)", "m", 0.75, QUELLE),
    ("strahler_temperatur_c", "Vorgabewert Oberflächentemperatur Modul (Wärmeverteilung)", "°C", None, ""),
    ("strahler_emissionsgrad", "Vorgabewert Emissionsgrad Modul (Wärmeverteilung)", "–", None, ""),
    ("strahler_abstrahlwinkel_grad", "Vorgabewert Abstrahlwinkel Modul (Wärmeverteilung)", "°", None, ""),
]


def upgrade() -> None:
    op.add_column('bib_modul', sa.Column('oberflaechentemperatur_c', sa.Float(), nullable=True))
    op.add_column('bib_modul', sa.Column('emissionsgrad', sa.Float(), nullable=True))
    op.add_column('bib_modul', sa.Column('abstrahlwinkel_grad', sa.Float(), nullable=True, comment='voller Abstrahlwinkel'))
    tabelle = sa.table(
        'platzierungsregel', sa.column('schluessel', sa.String), sa.column('bezeichnung', sa.String),
        sa.column('wert', sa.Float), sa.column('wert_text', sa.String), sa.column('einheit', sa.String),
        sa.column('erlaeuterung', sa.Text), sa.column('quelle', sa.String), sa.column('reihenfolge', sa.Integer),
    )
    op.bulk_insert(tabelle, [
        {"schluessel": s, "bezeichnung": b, "wert": w, "wert_text": "", "einheit": e, "erlaeuterung": "", "quelle": q,
         "reihenfolge": 18 + i}
        for i, (s, b, e, w, q) in enumerate(REGELN)
    ])


def downgrade() -> None:
    op.execute("DELETE FROM platzierungsregel WHERE schluessel IN ({})".format(", ".join(f"'{r[0]}'" for r in REGELN)))
    op.drop_column('bib_modul', 'abstrahlwinkel_grad')
    op.drop_column('bib_modul', 'emissionsgrad')
    op.drop_column('bib_modul', 'oberflaechentemperatur_c')
