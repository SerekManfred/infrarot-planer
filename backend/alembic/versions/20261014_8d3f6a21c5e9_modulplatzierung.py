"""Modulkatalog, Platzierungsregeln, Sperrflächen und Module je Raum (Festlegung Auftraggeber 14.10.2026)

- bib_modul: Deckenmodule (Preise/Montagezeit leer, bis geliefert)
- platzierungsregel: feste Regelliste (app/platzierungsregeln.py), angelegt ohne Werte („Vorgabe fehlt“)
- bib_raumtyp.richtwert_altbau_w_m2: Orientierung für den Fachprüfer bei Altbau, nur Anzeige
- raum.sperrflaechen, raum.module: Draufsicht der Decke

Revision ID: 8d3f6a21c5e9
Revises: 5e8b1c90d4a7
Create Date: 2026-10-14 16:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '8d3f6a21c5e9'
down_revision = '5e8b1c90d4a7'
branch_labels = None
depends_on = None

# Stand der Regelliste bei dieser Migration (wie app/platzierungsregeln.py, hier eigenständig)
REGELN = [
    ("abstand_wand_cm", "Mindestabstand Modul – Wand", "cm"),
    ("abstand_leuchte_cm", "Mindestabstand Modul – Leuchte / Spot", "cm"),
    ("abstand_rauchmelder_cm", "Mindestabstand Modul – Rauchmelder", "cm"),
    ("abstand_modul_cm", "Mindestabstand Modul – Modul", "cm"),
    ("abstand_sitzplatz_cm", "Mindestabstand zu Sperrfläche Sitzplatz", "cm"),
    ("bett_sperrflaeche", "Bett als Sperrfläche (ja/nein)", "ja/nein"),
    ("abstand_bett_cm", "Mindestabstand zu Sperrfläche Bett", "cm"),
    ("abstand_hochschrank_cm", "Mindestabstand zu Hochschrank", "cm"),
    ("abstand_dachschraege_cm", "Mindestabstand zu Dachschräge (Knick)", "cm"),
    ("abstand_dusche_cm", "Mindestabstand zu Dusche/Wanne", "cm"),
    ("abstand_sonstiges_cm", "Mindestabstand zu sonstiger Sperrfläche", "cm"),
    ("mindesthoehe_m", "Mindestraumhöhe für Deckenmontage", "m"),
    ("leistungsreserve_prozent", "Leistungsreserve", "%"),
    ("ueberdimensionierung_prozent", "Maximale Überdimensionierung", "%"),
    ("thermostat_je_raum", "Thermostat je Raum (ja/nein)", "ja/nein"),
    ("bad_min_schutzart", "Bad: zulässige Module", "min. Schutzart"),
    ("bevorzugte_lage", "Bevorzugte Lage im Raum", "Text"),
    ("bevorzugte_ausrichtung", "Bevorzugte Ausrichtung", "Text"),
]


def _zeitstempel() -> list[sa.Column]:
    return [
        sa.Column('erstellt_am', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('geaendert_am', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        'bib_modul',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('artikel_nr', sa.String(length=50), nullable=False),
        sa.Column('bezeichnung', sa.String(length=300), nullable=False),
        sa.Column('leistung_w', sa.Float(), nullable=False),
        sa.Column('laenge_mm', sa.Float(), nullable=False),
        sa.Column('breite_mm', sa.Float(), nullable=False),
        sa.Column('bauhoehe_mm', sa.Float(), nullable=True),
        sa.Column('gewicht_kg', sa.Float(), nullable=True),
        sa.Column('schutzart', sa.String(length=10), nullable=False, comment='z. B. IP44'),
        sa.Column('bad_geeignet', sa.Boolean(), nullable=False),
        sa.Column('oberflaeche', sa.String(length=300), nullable=False),
        sa.Column('ek_netto', sa.Float(), nullable=True, comment='€'),
        sa.Column('vk_netto', sa.Float(), nullable=True, comment='€'),
        sa.Column('montagezeit_min', sa.Float(), nullable=True),
        sa.Column('quelle', sa.String(length=500), nullable=False),
        sa.Column('bemerkung', sa.Text(), nullable=False),
        sa.Column('aktiv', sa.Boolean(), nullable=False, comment='inaktive Module werden nicht mehr vorgeschlagen'),
        *_zeitstempel(),
        sa.CheckConstraint('leistung_w > 0', name='ck_bib_modul_leistung'),
        sa.CheckConstraint('laenge_mm > 0 AND breite_mm > 0', name='ck_bib_modul_masse'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('artikel_nr'),
    )
    regel = op.create_table(
        'platzierungsregel',
        sa.Column('schluessel', sa.String(length=50), nullable=False),
        sa.Column('bezeichnung', sa.String(length=200), nullable=False),
        sa.Column('wert', sa.Float(), nullable=True, comment='Zahlenwert (cm, m, %)'),
        sa.Column('wert_text', sa.String(length=200), nullable=False, comment='ja/nein oder Text'),
        sa.Column('einheit', sa.String(length=50), nullable=False),
        sa.Column('erlaeuterung', sa.Text(), nullable=False),
        sa.Column('quelle', sa.String(length=500), nullable=False),
        sa.Column('reihenfolge', sa.Integer(), nullable=False),
        *_zeitstempel(),
        sa.PrimaryKeyConstraint('schluessel'),
    )
    op.bulk_insert(regel, [
        {"schluessel": s, "bezeichnung": b, "wert": None, "wert_text": "", "einheit": e, "erlaeuterung": "",
         "quelle": "", "reihenfolge": i}
        for i, (s, b, e) in enumerate(REGELN)
    ])
    op.add_column('bib_raumtyp', sa.Column('richtwert_altbau_w_m2', sa.Float(), nullable=True,
                                           comment='Richtwert W/m² Altbau, nur Anzeige'))
    op.add_column('raum', sa.Column('sperrflaechen', postgresql.JSONB(astext_type=sa.Text()),
                                    server_default='[]', nullable=False))
    op.add_column('raum', sa.Column('module', postgresql.JSONB(astext_type=sa.Text()), server_default='[]',
                                    nullable=False,
                                    comment='platzierte Module mit Kopie der Katalogdaten, damit Katalogänderungen den Plan nicht verändern'))


def downgrade() -> None:
    op.drop_column('raum', 'module')
    op.drop_column('raum', 'sperrflaechen')
    op.drop_column('bib_raumtyp', 'richtwert_altbau_w_m2')
    op.drop_table('platzierungsregel')
    op.drop_table('bib_modul')
