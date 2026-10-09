"""API-Schemas (Pydantic). Je Objektart: Neu (anlegen), Aenderung (teilweise ändern), Lesen (Antwort)."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Angrenzung = Literal["aussen", "beheizt", "unbeheizt", "erdreich"]
Rolle = Literal["admin", "berater"]


class Lesbar(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ── Anmeldung / Benutzer ────────────────────────────────────────────────────


class Anmeldung(BaseModel):
    email: str
    passwort: str


class BenutzerLesen(Lesbar):
    id: int
    email: str
    name: str
    rolle: Rolle
    aktiv: bool


class BenutzerNeu(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    name: str = Field(min_length=1, max_length=200)
    passwort: str = Field(min_length=12)
    rolle: Rolle = "berater"


# ── Projekt ─────────────────────────────────────────────────────────────────


class ProjektNeu(BaseModel):
    nummer: str = Field(min_length=1, max_length=50)
    bezeichnung: str = Field(min_length=1, max_length=300)
    kunde_name: str = ""
    notizen: str = ""


class ProjektAenderung(BaseModel):
    nummer: str | None = Field(default=None, min_length=1, max_length=50)
    bezeichnung: str | None = Field(default=None, min_length=1, max_length=300)
    kunde_name: str | None = None
    notizen: str | None = None


class ProjektLesen(Lesbar):
    id: int
    nummer: str
    bezeichnung: str
    kunde_name: str
    notizen: str
    ersteller_id: int | None
    erstellt_am: datetime
    geaendert_am: datetime


# ── Objekt ──────────────────────────────────────────────────────────────────


class ObjektNeu(BaseModel):
    bezeichnung: str = Field(min_length=1, max_length=300)
    strasse: str = ""
    plz: str = ""
    ort: str = ""
    baujahr: int | None = Field(default=None, ge=1000, le=2100)
    klimadaten_id: int | None = None
    delta_u_wb: float | None = Field(default=None, ge=0)


class ObjektAenderung(BaseModel):
    bezeichnung: str | None = Field(default=None, min_length=1, max_length=300)
    strasse: str | None = None
    plz: str | None = None
    ort: str | None = None
    baujahr: int | None = Field(default=None, ge=1000, le=2100)
    klimadaten_id: int | None = None
    delta_u_wb: float | None = Field(default=None, ge=0)


class ObjektLesen(Lesbar):
    id: int
    projekt_id: int
    bezeichnung: str
    strasse: str
    plz: str
    ort: str
    baujahr: int | None
    klimadaten_id: int | None
    delta_u_wb: float | None


# ── Geschoss ────────────────────────────────────────────────────────────────


class GeschossNeu(BaseModel):
    bezeichnung: str = Field(min_length=1, max_length=100)
    reihenfolge: int = 0


class GeschossAenderung(BaseModel):
    bezeichnung: str | None = Field(default=None, min_length=1, max_length=100)
    reihenfolge: int | None = None


class GeschossLesen(Lesbar):
    id: int
    objekt_id: int
    bezeichnung: str
    reihenfolge: int


# ── Raum ────────────────────────────────────────────────────────────────────


class RaumNeu(BaseModel):
    bezeichnung: str = Field(min_length=1, max_length=200)
    raumtyp_id: int | None = None
    flaeche_m2: float | None = Field(default=None, ge=0)
    hoehe_m: float | None = Field(default=None, ge=0)
    volumen_m3: float | None = Field(default=None, ge=0)
    theta_int: float | None = None
    luftwechsel: float | None = Field(default=None, ge=0)


class RaumAenderung(RaumNeu):
    bezeichnung: str | None = Field(default=None, min_length=1, max_length=200)


class RaumLesen(Lesbar):
    id: int
    geschoss_id: int
    bezeichnung: str
    raumtyp_id: int | None
    flaeche_m2: float | None
    hoehe_m: float | None
    volumen_m3: float | None
    theta_int: float | None
    luftwechsel: float | None


# ── Bauteilfläche ───────────────────────────────────────────────────────────


class FlaecheNeu(BaseModel):
    bezeichnung: str = ""
    bauteil_id: int | None = None
    u_wert: float | None = Field(default=None, ge=0)
    flaeche_brutto_m2: float = Field(ge=0)
    orientierung: str = Field(default="", max_length=5)
    angrenzung: Angrenzung = "aussen"
    theta_angrenzend: float | None = None
    f_korrektur: float | None = None
    delta_u_wb: float | None = Field(default=None, ge=0)


class FlaecheAenderung(FlaecheNeu):
    flaeche_brutto_m2: float | None = Field(default=None, ge=0)
    angrenzung: Angrenzung | None = None


class FlaecheLesen(Lesbar):
    id: int
    raum_id: int
    bezeichnung: str
    bauteil_id: int | None
    u_wert: float | None
    flaeche_brutto_m2: float
    orientierung: str
    angrenzung: Angrenzung
    theta_angrenzend: float | None
    f_korrektur: float | None
    delta_u_wb: float | None


# ── Öffnung ─────────────────────────────────────────────────────────────────


class OeffnungNeu(BaseModel):
    bezeichnung: str = ""
    bauteil_id: int | None = None
    u_wert: float | None = Field(default=None, ge=0)
    flaeche_m2: float = Field(ge=0)
    anzahl: int = Field(default=1, ge=1)


class OeffnungAenderung(OeffnungNeu):
    flaeche_m2: float | None = Field(default=None, ge=0)
    anzahl: int | None = Field(default=None, ge=1)


class OeffnungLesen(Lesbar):
    id: int
    bauteilflaeche_id: int
    bezeichnung: str
    bauteil_id: int | None
    u_wert: float | None
    flaeche_m2: float
    anzahl: int


# ── Bibliotheken ────────────────────────────────────────────────────────────


class BauteilLesen(Lesbar):
    id: int
    kategorie: str
    bezeichnung: str
    baualtersklasse: str
    u_wert: float
    quelle: str
    bemerkung: str


class RaumtypLesen(Lesbar):
    id: int
    bezeichnung: str
    theta_int: float
    luftwechsel: float
    quelle: str
    bemerkung: str


class KlimadatenLesen(Lesbar):
    id: int
    plz: str
    ort: str
    theta_e: float
    theta_m_e: float | None
    quelle: str


class ImportBericht(BaseModel):
    neu: int
    aktualisiert: int
    fehler: list[str]


# ── Berechnung ──────────────────────────────────────────────────────────────


class BerechnungNeu(BaseModel):
    bemerkung: str = ""


class BerechnungKurz(Lesbar):
    id: int
    objekt_id: int
    version: int
    art: str
    rechenkern_version: str
    bemerkung: str
    erstellt_von_id: int | None
    erstellt_am: datetime


class BerechnungLesen(BerechnungKurz):
    eingaben: dict
    ergebnis: dict
