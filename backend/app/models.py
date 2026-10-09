"""Datenmodell.

Hierarchie: Projekt → Objekt (Gebäude) → Geschoss → Raum → Bauteilfläche → Öffnung.
Bibliotheken (Bauteile, Raumtypen, Klimadaten) werden per CSV-Import gefüllt und nie mit erfundenen Werten vorbelegt.
Berechnungen speichern Eingaben und Ergebnis unveränderlich und sind je Objekt fortlaufend versioniert.
"""
from datetime import datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

JsonDaten = JSON().with_variant(JSONB(), "postgresql")

ROLLEN = ("admin", "berater")
ANGRENZUNGEN = ("aussen", "beheizt", "unbeheizt", "erdreich")


def _erlaubt(spalte: str, werte: tuple[str, ...]) -> str:
    return f"{spalte} IN ({', '.join(repr(w) for w in werte)})"


class Zeitstempel:
    erstellt_am: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    geaendert_am: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Benutzer(Zeitstempel, Base):
    __tablename__ = "benutzer"
    __table_args__ = (CheckConstraint(_erlaubt("rolle", ROLLEN), name="ck_benutzer_rolle"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    passwort_hash: Mapped[str] = mapped_column(String(255))
    rolle: Mapped[str] = mapped_column(String(20), default="berater")
    aktiv: Mapped[bool] = mapped_column(default=True)


# ── Bibliotheken ────────────────────────────────────────────────────────────


class BibBauteil(Zeitstempel, Base):
    """Bauteil mit U-Wert, z. B. Pauschalwert nach der Bekanntmachung für den Wohngebäudebestand."""

    __tablename__ = "bib_bauteil"
    __table_args__ = (
        UniqueConstraint("kategorie", "bezeichnung", "baualtersklasse", name="uq_bib_bauteil"),
        CheckConstraint("u_wert > 0", name="ck_bib_bauteil_u_wert"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kategorie: Mapped[str] = mapped_column(String(100))
    bezeichnung: Mapped[str] = mapped_column(String(300))
    baualtersklasse: Mapped[str] = mapped_column(String(100), default="")
    u_wert: Mapped[float] = mapped_column(Float, comment="W/(m²·K)")
    quelle: Mapped[str] = mapped_column(String(500))
    bemerkung: Mapped[str] = mapped_column(Text, default="")


class BibRaumtyp(Zeitstempel, Base):
    __tablename__ = "bib_raumtyp"

    id: Mapped[int] = mapped_column(primary_key=True)
    bezeichnung: Mapped[str] = mapped_column(String(200), unique=True)
    theta_int: Mapped[float] = mapped_column(Float, comment="Norm-Innentemperatur in °C")
    luftwechsel: Mapped[float] = mapped_column(Float, comment="Luftwechselrate n in 1/h")
    quelle: Mapped[str] = mapped_column(String(500))
    bemerkung: Mapped[str] = mapped_column(Text, default="")


class BibKlimadaten(Zeitstempel, Base):
    """Norm-Außentemperatur nach DIN/TS 12831-1 je PLZ/Ort."""

    __tablename__ = "bib_klimadaten"
    __table_args__ = (UniqueConstraint("plz", "ort", name="uq_bib_klimadaten"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plz: Mapped[str] = mapped_column(String(10), default="", index=True)
    ort: Mapped[str] = mapped_column(String(200))
    theta_e: Mapped[float] = mapped_column(Float, comment="Norm-Außentemperatur in °C")
    theta_m_e: Mapped[float | None] = mapped_column(Float, comment="Jahresmittel der Außentemperatur in °C")
    quelle: Mapped[str] = mapped_column(String(500))


# ── Projektdaten ────────────────────────────────────────────────────────────


class Projekt(Zeitstempel, Base):
    __tablename__ = "projekt"

    id: Mapped[int] = mapped_column(primary_key=True)
    nummer: Mapped[str] = mapped_column(String(50), unique=True)
    bezeichnung: Mapped[str] = mapped_column(String(300))
    kunde_name: Mapped[str] = mapped_column(String(300), default="")
    notizen: Mapped[str] = mapped_column(Text, default="")
    ersteller_id: Mapped[int | None] = mapped_column(ForeignKey("benutzer.id", ondelete="SET NULL"))

    ersteller: Mapped[Benutzer | None] = relationship()
    objekte: Mapped[list["Objekt"]] = relationship(back_populates="projekt", passive_deletes=True)


class Objekt(Zeitstempel, Base):
    """Gebäude bzw. Wohneinheit, für die gerechnet wird."""

    __tablename__ = "objekt"

    id: Mapped[int] = mapped_column(primary_key=True)
    projekt_id: Mapped[int] = mapped_column(ForeignKey("projekt.id", ondelete="CASCADE"), index=True)
    bezeichnung: Mapped[str] = mapped_column(String(300))
    strasse: Mapped[str] = mapped_column(String(300), default="")
    plz: Mapped[str] = mapped_column(String(10), default="")
    ort: Mapped[str] = mapped_column(String(200), default="")
    baujahr: Mapped[int | None] = mapped_column(Integer)
    klimadaten_id: Mapped[int | None] = mapped_column(ForeignKey("bib_klimadaten.id", ondelete="RESTRICT"))
    delta_u_wb: Mapped[float | None] = mapped_column(Float, comment="Wärmebrückenzuschlag in W/(m²·K)")

    projekt: Mapped[Projekt] = relationship(back_populates="objekte")
    klimadaten: Mapped[BibKlimadaten | None] = relationship()
    geschosse: Mapped[list["Geschoss"]] = relationship(
        back_populates="objekt", passive_deletes=True, order_by="Geschoss.reihenfolge"
    )


class Geschoss(Zeitstempel, Base):
    __tablename__ = "geschoss"

    id: Mapped[int] = mapped_column(primary_key=True)
    objekt_id: Mapped[int] = mapped_column(ForeignKey("objekt.id", ondelete="CASCADE"), index=True)
    bezeichnung: Mapped[str] = mapped_column(String(100))
    reihenfolge: Mapped[int] = mapped_column(default=0)

    objekt: Mapped[Objekt] = relationship(back_populates="geschosse")
    raeume: Mapped[list["Raum"]] = relationship(back_populates="geschoss", passive_deletes=True, order_by="Raum.id")


class Raum(Zeitstempel, Base):
    __tablename__ = "raum"
    __table_args__ = (
        CheckConstraint("flaeche_m2 >= 0", name="ck_raum_flaeche"),
        CheckConstraint("hoehe_m >= 0", name="ck_raum_hoehe"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    geschoss_id: Mapped[int] = mapped_column(ForeignKey("geschoss.id", ondelete="CASCADE"), index=True)
    bezeichnung: Mapped[str] = mapped_column(String(200))
    raumtyp_id: Mapped[int | None] = mapped_column(ForeignKey("bib_raumtyp.id", ondelete="RESTRICT"))
    flaeche_m2: Mapped[float | None] = mapped_column(Float)
    hoehe_m: Mapped[float | None] = mapped_column(Float, comment="lichte Raumhöhe in m")
    volumen_m3: Mapped[float | None] = mapped_column(Float, comment="überschreibt Fläche × Höhe")
    theta_int: Mapped[float | None] = mapped_column(Float, comment="überschreibt den Raumtyp, °C")
    luftwechsel: Mapped[float | None] = mapped_column(Float, comment="überschreibt den Raumtyp, 1/h")

    geschoss: Mapped[Geschoss] = relationship(back_populates="raeume")
    raumtyp: Mapped[BibRaumtyp | None] = relationship()
    flaechen: Mapped[list["Bauteilflaeche"]] = relationship(
        back_populates="raum", passive_deletes=True, order_by="Bauteilflaeche.id"
    )


class Bauteilflaeche(Zeitstempel, Base):
    __tablename__ = "bauteilflaeche"
    __table_args__ = (
        CheckConstraint(_erlaubt("angrenzung", ANGRENZUNGEN), name="ck_bauteilflaeche_angrenzung"),
        CheckConstraint("flaeche_brutto_m2 >= 0", name="ck_bauteilflaeche_flaeche"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    raum_id: Mapped[int] = mapped_column(ForeignKey("raum.id", ondelete="CASCADE"), index=True)
    bezeichnung: Mapped[str] = mapped_column(String(200), default="")
    bauteil_id: Mapped[int | None] = mapped_column(ForeignKey("bib_bauteil.id", ondelete="RESTRICT"))
    u_wert: Mapped[float | None] = mapped_column(Float, comment="überschreibt das Bauteil, W/(m²·K)")
    flaeche_brutto_m2: Mapped[float] = mapped_column(Float)
    orientierung: Mapped[str] = mapped_column(String(5), default="")
    angrenzung: Mapped[str] = mapped_column(String(20), default="aussen")
    theta_angrenzend: Mapped[float | None] = mapped_column(Float, comment="°C")
    f_korrektur: Mapped[float | None] = mapped_column(Float)
    delta_u_wb: Mapped[float | None] = mapped_column(Float, comment="überschreibt den Objektwert, W/(m²·K)")

    raum: Mapped[Raum] = relationship(back_populates="flaechen")
    bauteil: Mapped[BibBauteil | None] = relationship()
    oeffnungen: Mapped[list["Oeffnung"]] = relationship(
        back_populates="flaeche", passive_deletes=True, order_by="Oeffnung.id"
    )


class Oeffnung(Zeitstempel, Base):
    """Fenster oder Tür in einer Bauteilfläche."""

    __tablename__ = "oeffnung"
    __table_args__ = (
        CheckConstraint("flaeche_m2 >= 0", name="ck_oeffnung_flaeche"),
        CheckConstraint("anzahl >= 1", name="ck_oeffnung_anzahl"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    bauteilflaeche_id: Mapped[int] = mapped_column(ForeignKey("bauteilflaeche.id", ondelete="CASCADE"), index=True)
    bezeichnung: Mapped[str] = mapped_column(String(200), default="")
    bauteil_id: Mapped[int | None] = mapped_column(ForeignKey("bib_bauteil.id", ondelete="RESTRICT"))
    u_wert: Mapped[float | None] = mapped_column(Float, comment="überschreibt das Bauteil, W/(m²·K)")
    flaeche_m2: Mapped[float] = mapped_column(Float, comment="Fläche einer Öffnung")
    anzahl: Mapped[int] = mapped_column(default=1)

    flaeche: Mapped[Bauteilflaeche] = relationship(back_populates="oeffnungen")
    bauteil: Mapped[BibBauteil | None] = relationship()


class Berechnung(Base):
    """Unveränderlicher Rechenlauf mit vollständigem Eingabe-Schnappschuss."""

    __tablename__ = "berechnung"
    __table_args__ = (UniqueConstraint("objekt_id", "version", name="uq_berechnung_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    objekt_id: Mapped[int] = mapped_column(ForeignKey("objekt.id", ondelete="CASCADE"), index=True)
    version: Mapped[int]
    art: Mapped[str] = mapped_column(String(50), default="heizlast")
    rechenkern_version: Mapped[str] = mapped_column(String(20))
    eingaben: Mapped[dict] = mapped_column(JsonDaten)
    ergebnis: Mapped[dict] = mapped_column(JsonDaten)
    bemerkung: Mapped[str] = mapped_column(Text, default="")
    erstellt_von_id: Mapped[int | None] = mapped_column(ForeignKey("benutzer.id", ondelete="SET NULL"))
    erstellt_am: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
