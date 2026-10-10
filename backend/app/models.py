"""Datenmodell.

Hierarchie: Projekt → Objekt (Gebäude) → Geschoss → Raum → Bauteilfläche → Öffnung.
Fachvorgaben (Pauschalen, Rückfallwerte, Höhenzuschlag, ΔU_WB, Raumtyp-Kennwerte) werden von Fachprüfern gepflegt;
Bibliotheken (Bauteile, Klimadaten) per CSV-Import. Nichts wird mit erfundenen Werten vorbelegt.
Berechnungen speichern Eingaben und Ergebnis unveränderlich und sind je Objekt fortlaufend versioniert.
Jede Änderung landet im Protokoll (app/protokoll.py).
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

ROLLEN = ("admin", "fachpruefer", "aussendienst")
ANGRENZUNGEN = ("aussen", "beheizt", "unbeheizt", "erdreich")
PROJEKTSTATUS = ("entwurf", "geprueft", "freigegeben")
GEBAEUDESTANDARDS = ("neubau", "effizienzhaus_sanierung", "sonstiger_bestand")
HEIZLASTQUELLEN = ("A", "B", "C")


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
    rolle: Mapped[str] = mapped_column(String(20), default="aussendienst")
    aktiv: Mapped[bool] = mapped_column(default=True)
    # Wird bei Passwortänderung und Deaktivierung erhöht; ältere Sitzungs-Token werden damit ungültig
    sitzungs_version: Mapped[int] = mapped_column(default=0, server_default="0")


class Anmeldeversuch(Base):
    """Grundlage der Bremse gegen Anmeldeversuche."""

    __tablename__ = "anmeldeversuch"

    id: Mapped[int] = mapped_column(primary_key=True)
    zeitpunkt: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    email: Mapped[str] = mapped_column(String(254), index=True)
    ip: Mapped[str] = mapped_column(String(64), index=True)
    erfolgreich: Mapped[bool]


class Protokoll(Base):
    """Änderungsprotokoll. projekt_id ohne Fremdschlüssel, damit Einträge gelöschter Projekte erhalten bleiben."""

    __tablename__ = "protokoll"

    id: Mapped[int] = mapped_column(primary_key=True)
    zeitpunkt: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    benutzer_id: Mapped[int | None] = mapped_column(ForeignKey("benutzer.id", ondelete="SET NULL"))
    projekt_id: Mapped[int | None] = mapped_column(index=True)
    objektart: Mapped[str] = mapped_column(String(50))
    objekt_id: Mapped[int | None]
    aktion: Mapped[str] = mapped_column(String(20))
    aenderungen: Mapped[dict] = mapped_column(JsonDaten, default=dict)

    benutzer: Mapped[Benutzer | None] = relationship()


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
    """Raumtyp mit Kennwerten für Quelle C. Leere Kennwerte = „Vorgabe fehlt“."""

    __tablename__ = "bib_raumtyp"

    id: Mapped[int] = mapped_column(primary_key=True)
    bezeichnung: Mapped[str] = mapped_column(String(200), unique=True)
    theta_int: Mapped[float | None] = mapped_column(Float, comment="Norm-Innentemperatur in °C")
    luftwechsel: Mapped[float | None] = mapped_column(Float, comment="Luftwechselrate n in 1/h")
    reduktionsfaktor: Mapped[float | None] = mapped_column(
        Float, comment="Temperatur-Korrekturfaktor f für Bauteile, die an einen Raum dieses Typs grenzen"
    )
    quelle: Mapped[str] = mapped_column(String(500), default="")
    bemerkung: Mapped[str] = mapped_column(Text, default="")
    reihenfolge: Mapped[int] = mapped_column(default=0, server_default="0")


class HeizlastPauschale(Zeitstempel, Base):
    """Heizlast-Pauschale in W/m² je Raumtyp und Gebäudestandard (Quelle A)."""

    __tablename__ = "heizlast_pauschale"
    __table_args__ = (
        UniqueConstraint("raumtyp_id", "gebaeudestandard", name="uq_heizlast_pauschale"),
        CheckConstraint(_erlaubt("gebaeudestandard", GEBAEUDESTANDARDS), name="ck_heizlast_pauschale_standard"),
        CheckConstraint("w_m2 >= 0", name="ck_heizlast_pauschale_w_m2"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    raumtyp_id: Mapped[int] = mapped_column(ForeignKey("bib_raumtyp.id", ondelete="CASCADE"), index=True)
    gebaeudestandard: Mapped[str] = mapped_column(String(30))
    w_m2: Mapped[float] = mapped_column(Float)
    quelle: Mapped[str] = mapped_column(String(500), default="")


class Fachvorgaben(Zeitstempel, Base):
    """Zentrale Einzelwerte; genau eine Zeile (id = 1). Leere Werte = „Vorgabe fehlt“."""

    __tablename__ = "fachvorgaben"
    __table_args__ = (CheckConstraint("id = 1", name="ck_fachvorgaben_eine_zeile"),)

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    rueckfall_neubau_w_m2: Mapped[float | None] = mapped_column(Float)
    rueckfall_effizienzhaus_sanierung_w_m2: Mapped[float | None] = mapped_column(Float)
    rueckfall_sonstiger_bestand_w_m2: Mapped[float | None] = mapped_column(Float)
    hoehenzuschlag_grenzhoehe_m: Mapped[float | None] = mapped_column(Float)
    hoehenzuschlag_prozent_je_m: Mapped[float | None] = mapped_column(Float)
    delta_u_wb: Mapped[float | None] = mapped_column(Float, comment="W/(m²·K), für Quelle C")
    quelle: Mapped[str] = mapped_column(Text, default="")


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
    __table_args__ = (CheckConstraint(_erlaubt("status", PROJEKTSTATUS), name="ck_projekt_status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    nummer: Mapped[str] = mapped_column(String(50), unique=True)
    bezeichnung: Mapped[str] = mapped_column(String(300))
    kunde_name: Mapped[str] = mapped_column(String(300), default="")
    notizen: Mapped[str] = mapped_column(Text, default="")
    ersteller_id: Mapped[int | None] = mapped_column(ForeignKey("benutzer.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="entwurf", server_default="entwurf")
    geprueft_von_id: Mapped[int | None] = mapped_column(ForeignKey("benutzer.id", ondelete="SET NULL"))
    geprueft_am: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    freigegeben_von_id: Mapped[int | None] = mapped_column(ForeignKey("benutzer.id", ondelete="SET NULL"))
    freigegeben_am: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Offline-Sperre: Ein Gerät hat das Projekt zur Offline-Bearbeitung ausgecheckt (app/projektzugriff.py).
    # Gespeichert wird nur der SHA-256 des Sperr-Tokens; das Token selbst kennt nur das Gerät.
    ausgecheckt_von_id: Mapped[int | None] = mapped_column(ForeignKey("benutzer.id", ondelete="SET NULL"))
    ausgecheckt_geraet: Mapped[str | None] = mapped_column(String(100))
    ausgecheckt_am: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sperre_hash: Mapped[str | None] = mapped_column(String(64))

    ersteller: Mapped[Benutzer | None] = relationship(foreign_keys=[ersteller_id])
    ausgecheckt_von: Mapped[Benutzer | None] = relationship(foreign_keys=[ausgecheckt_von_id])
    objekte: Mapped[list["Objekt"]] = relationship(back_populates="projekt", passive_deletes=True)

    @property
    def ausgecheckt_von_name(self) -> str | None:
        if self.ausgecheckt_am is None:
            return None
        return self.ausgecheckt_von.name if self.ausgecheckt_von else "gelöschter Benutzer"


class Objekt(Zeitstempel, Base):
    """Gebäude bzw. Wohneinheit, für die gerechnet wird. Trägt auch die projektbezogenen Abweichungen von den Fachvorgaben."""

    __tablename__ = "objekt"
    __table_args__ = (
        CheckConstraint(_erlaubt("gebaeudestandard", GEBAEUDESTANDARDS), name="ck_objekt_gebaeudestandard"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    projekt_id: Mapped[int] = mapped_column(ForeignKey("projekt.id", ondelete="CASCADE"), index=True)
    bezeichnung: Mapped[str] = mapped_column(String(300))
    strasse: Mapped[str] = mapped_column(String(300), default="")
    plz: Mapped[str] = mapped_column(String(10), default="")
    ort: Mapped[str] = mapped_column(String(200), default="")
    baujahr: Mapped[int | None] = mapped_column(Integer)
    gebaeudestandard: Mapped[str] = mapped_column(String(30))
    klimadaten_id: Mapped[int | None] = mapped_column(ForeignKey("bib_klimadaten.id", ondelete="RESTRICT"))
    # Abweichungen von den zentralen Fachvorgaben (leer = zentrale Vorgabe gilt)
    delta_u_wb: Mapped[float | None] = mapped_column(Float, comment="Wärmebrückenzuschlag in W/(m²·K)")
    hoehenzuschlag_grenzhoehe_m: Mapped[float | None] = mapped_column(Float)
    hoehenzuschlag_prozent_je_m: Mapped[float | None] = mapped_column(Float)
    pauschale_abweichungen: Mapped[dict] = mapped_column(
        JsonDaten, default=dict, comment="{raumtyp_id: W/m²}, gilt für alle Räume dieses Typs im Objekt"
    )

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
        CheckConstraint(_erlaubt("heizlastquelle", HEIZLASTQUELLEN), name="ck_raum_heizlastquelle"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    geschoss_id: Mapped[int] = mapped_column(ForeignKey("geschoss.id", ondelete="CASCADE"), index=True)
    bezeichnung: Mapped[str] = mapped_column(String(200))
    raumtyp_id: Mapped[int | None] = mapped_column(ForeignKey("bib_raumtyp.id", ondelete="RESTRICT"))
    laenge_m: Mapped[float | None] = mapped_column(Float)
    breite_m: Mapped[float | None] = mapped_column(Float)
    flaeche_m2: Mapped[float | None] = mapped_column(Float, comment="= Länge × Breite, wenn beide angegeben")
    hoehe_m: Mapped[float | None] = mapped_column(Float, comment="lichte Raumhöhe in m")
    volumen_m3: Mapped[float | None] = mapped_column(Float, comment="überschreibt Fläche × Höhe")
    heizlastquelle: Mapped[str] = mapped_column(String(1), default="A", server_default="A")
    hottgenroth_w: Mapped[float | None] = mapped_column(Float, comment="Raumheizlast aus Hottgenroth (Quelle B)")
    # Abweichungen von den Fachvorgaben je Raum
    pauschale_w_m2: Mapped[float | None] = mapped_column(Float, comment="überschreibt die Pauschale, W/m²")
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
    angrenzender_raumtyp_id: Mapped[int | None] = mapped_column(
        ForeignKey("bib_raumtyp.id", ondelete="RESTRICT"), comment="liefert den Reduktionsfaktor f"
    )
    theta_angrenzend: Mapped[float | None] = mapped_column(Float, comment="°C")
    f_korrektur: Mapped[float | None] = mapped_column(Float)
    delta_u_wb: Mapped[float | None] = mapped_column(Float, comment="überschreibt den Objektwert, W/(m²·K)")

    raum: Mapped[Raum] = relationship(back_populates="flaechen")
    bauteil: Mapped[BibBauteil | None] = relationship()
    angrenzender_raumtyp: Mapped[BibRaumtyp | None] = relationship()
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
    art: Mapped[str] = mapped_column(String(50), default="auswertung")
    rechenkern_version: Mapped[str] = mapped_column(String(20))
    eingaben: Mapped[dict] = mapped_column(JsonDaten)
    ergebnis: Mapped[dict] = mapped_column(JsonDaten)
    bemerkung: Mapped[str] = mapped_column(Text, default="")
    erstellt_von_id: Mapped[int | None] = mapped_column(ForeignKey("benutzer.id", ondelete="SET NULL"))
    erstellt_am: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
