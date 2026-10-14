"""API-Schemas (Pydantic). Je Objektart: Neu (anlegen), Aenderung (teilweise ändern), Lesen (Antwort)."""
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

Angrenzung = Literal["aussen", "beheizt", "unbeheizt", "erdreich"]
Rolle = Literal["admin", "fachpruefer", "aussendienst"]
Projektstatus = Literal["entwurf", "geprueft", "freigegeben"]
Gebaeudestandard = Literal["neubau", "effizienzhaus_sanierung", "sonstiger_bestand"]
Heizlastquelle = Literal["A", "B", "C"]

GEBAEUDESTANDARD_TEXT = {
    "neubau": "Neubau",
    "effizienzhaus_sanierung": "Effizienzhaus-Sanierung",
    "sonstiger_bestand": "Altbau (nicht Effizienzhaus)",
}


ROLLEN_REIHENFOLGE = ("admin", "fachpruefer", "aussendienst")


def _rollen_ordnen(rollen: list[str]) -> list[str]:
    """Doppelte entfernen, feste Reihenfolge – damit das Protokoll nur echte Änderungen zeigt."""
    return [r for r in ROLLEN_REIHENFOLGE if r in rollen]


# Rollen sind kombinierbar; mindestens eine
Rollen = Annotated[list[Rolle], Field(min_length=1, max_length=3), AfterValidator(_rollen_ordnen)]


class Lesbar(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ── Anmeldung / Benutzer ────────────────────────────────────────────────────


class Anmeldung(BaseModel):
    email: str
    passwort: str


class PasswortAendern(BaseModel):
    altes_passwort: str
    neues_passwort: str = Field(min_length=12)


class PasswortSetzen(BaseModel):
    neues_passwort: str = Field(min_length=12)


class BenutzerLesen(Lesbar):
    id: int
    email: str
    name: str
    rollen: list[Rolle]
    aktiv: bool


class BenutzerNeu(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    name: str = Field(min_length=1, max_length=200)
    passwort: str = Field(min_length=12)
    rollen: Rollen = ["aussendienst"]


class BenutzerAenderung(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    rollen: Rollen | None = None
    aktiv: bool | None = None


# ── Projekt ─────────────────────────────────────────────────────────────────


class ProjektNeu(BaseModel):
    nummer: str = Field(min_length=1, max_length=50)
    bezeichnung: str = Field(min_length=1, max_length=300)
    kunde_name: str = ""
    notizen: str = ""
    # Für das automatisch angelegte Gebäude (Objekt)
    gebaeudestandard: Gebaeudestandard
    strasse: str = ""
    plz: str = ""
    ort: str = ""


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
    status: Projektstatus
    ersteller_id: int | None
    geprueft_von_id: int | None
    geprueft_am: datetime | None
    freigegeben_von_id: int | None
    freigegeben_am: datetime | None
    ausgecheckt_von_id: int | None
    ausgecheckt_von_name: str | None
    ausgecheckt_geraet: str | None
    ausgecheckt_am: datetime | None
    # Stand der eingefrorenen Fachvorgaben (beim Anlegen bzw. bei der letzten Übernahme)
    vorgaben_stand_am: datetime | None
    # Altbau mit Räumen ohne W/m²-Wert: wartet auf den Fachprüfer, gesperrt für Prüfung und Angebot
    wartet_auf_fachpruefer: bool
    # neue zentrale Fachvorgaben, über die der Fachprüfer noch nicht entschieden hat (übernehmen oder ablehnen)
    vorgaben_offen: bool
    # kein Angebot möglich: wartet_auf_fachpruefer oder vorgaben_offen
    angebot_gesperrt: bool
    erstellt_am: datetime
    geaendert_am: datetime


class Auschecken(BaseModel):
    # Anzeigename des Geräts, z. B. „Tablet Außendienst 2“
    geraet: str = Field(min_length=1, max_length=100)


class AuscheckenAntwort(BaseModel):
    projekt: ProjektLesen
    # Sperr-Token: nur das auscheckende Gerät kennt es und sendet es als Kopf X-Sperre mit
    sperre: str


class StatusAenderung(BaseModel):
    status: Projektstatus
    bemerkung: str = ""


class ProtokollLesen(Lesbar):
    id: int
    zeitpunkt: datetime
    benutzer_id: int | None
    benutzer_name: str
    projekt_id: int | None
    objektart: str
    objekt_id: int | None
    aktion: str
    aenderungen: dict


# ── Objekt (Gebäude) ────────────────────────────────────────────────────────


class ObjektNeu(BaseModel):
    bezeichnung: str = Field(min_length=1, max_length=300)
    gebaeudestandard: Gebaeudestandard
    strasse: str = ""
    plz: str = ""
    ort: str = ""
    baujahr: int | None = Field(default=None, ge=1000, le=2100)
    klimadaten_id: int | None = None
    delta_u_wb: float | None = Field(default=None, ge=0)
    pauschale_abweichungen: dict[str, float] = Field(default_factory=dict)


class ObjektAenderung(BaseModel):
    bezeichnung: str | None = Field(default=None, min_length=1, max_length=300)
    gebaeudestandard: Gebaeudestandard | None = None
    strasse: str | None = None
    plz: str | None = None
    ort: str | None = None
    baujahr: int | None = Field(default=None, ge=1000, le=2100)
    klimadaten_id: int | None = None
    delta_u_wb: float | None = Field(default=None, ge=0)
    pauschale_abweichungen: dict[str, float] | None = None


class ObjektLesen(Lesbar):
    id: int
    projekt_id: int
    bezeichnung: str
    gebaeudestandard: Gebaeudestandard
    strasse: str
    plz: str
    ort: str
    baujahr: int | None
    klimadaten_id: int | None
    delta_u_wb: float | None
    pauschale_abweichungen: dict[str, float]


class ProjektDetail(ProjektLesen):
    objekte: list[ObjektLesen]


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

# Draufsicht der Decke (Festlegung 14.10.2026): Maße in m ab der linken oberen Raumecke; x entlang der Raumlänge,
# y entlang der Raumbreite. IDs vergibt das Gerät (auch offline), daher Text.
SperrflaecheTyp = Literal[
    "sitzplatz", "bett", "hochschrank", "dachschraege", "dusche", "sonstiges", "leuchte", "rauchmelder"
]


class Sperrflaeche(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    typ: SperrflaecheTyp
    # Rechteck: linke obere Ecke und Ausdehnung; Leuchte/Rauchmelder: Punkt (b = t = 0)
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    b: float = Field(default=0, ge=0, le=100)
    t: float = Field(default=0, ge=0, le=100)
    # nur Dachschräge: Wand, an der der Streifen liegt
    wand: Literal["oben", "unten", "links", "rechts"] | None = None
    bezeichnung: str = Field(default="", max_length=100)


class ModulPlatziert(BaseModel):
    """Platziertes Modul mit Kopie der Katalogdaten (Stand bei der Auswahl)."""

    id: str = Field(min_length=1, max_length=40)
    modul_id: int | None = None
    artikel_nr: str = Field(max_length=50)
    bezeichnung: str = Field(max_length=300)
    leistung_w: float = Field(gt=0)
    laenge_m: float = Field(gt=0, le=10)
    breite_m: float = Field(gt=0, le=10)
    schutzart: str = Field(default="", max_length=10)
    bad_geeignet: bool = False
    # linke obere Ecke; gedreht = False: Modullänge entlang der Raumlänge (x)
    x: float = Field(ge=-10, le=100)
    y: float = Field(ge=-10, le=100)
    gedreht: bool = False


class RaumNeu(BaseModel):
    bezeichnung: str = Field(min_length=1, max_length=200)
    raumtyp_id: int | None = None
    laenge_m: float | None = Field(default=None, ge=0, le=100)
    breite_m: float | None = Field(default=None, ge=0, le=100)
    flaeche_m2: float | None = Field(default=None, ge=0)
    hoehe_m: float | None = Field(default=None, ge=0, le=20)
    volumen_m3: float | None = Field(default=None, ge=0)
    heizlastquelle: Heizlastquelle = "A"
    hottgenroth_w: float | None = Field(default=None, ge=0)
    pauschale_w_m2: float | None = Field(default=None, ge=0)
    theta_int: float | None = None
    luftwechsel: float | None = Field(default=None, ge=0)
    sperrflaechen: list[Sperrflaeche] = Field(default_factory=list, max_length=100)
    module: list[ModulPlatziert] = Field(default_factory=list, max_length=60)


class RaumAenderung(RaumNeu):
    bezeichnung: str | None = Field(default=None, min_length=1, max_length=200)
    heizlastquelle: Heizlastquelle | None = None


class RaumLesen(Lesbar):
    id: int
    geschoss_id: int
    bezeichnung: str
    raumtyp_id: int | None
    laenge_m: float | None
    breite_m: float | None
    flaeche_m2: float | None
    hoehe_m: float | None
    volumen_m3: float | None
    heizlastquelle: Heizlastquelle
    hottgenroth_w: float | None
    pauschale_w_m2: float | None
    theta_int: float | None
    luftwechsel: float | None
    sperrflaechen: list[dict]
    module: list[dict]


# ── Bauteilfläche ───────────────────────────────────────────────────────────


class FlaecheNeu(BaseModel):
    bezeichnung: str = ""
    bauteil_id: int | None = None
    u_wert: float | None = Field(default=None, ge=0)
    flaeche_brutto_m2: float = Field(ge=0)
    orientierung: str = Field(default="", max_length=5)
    angrenzung: Angrenzung = "aussen"
    angrenzender_raumtyp_id: int | None = None
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
    angrenzender_raumtyp_id: int | None
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


# ── Bibliotheken und Fachvorgaben ───────────────────────────────────────────


class BauteilLesen(Lesbar):
    id: int
    kategorie: str
    bezeichnung: str
    baualtersklasse: str
    u_wert: float
    quelle: str
    bemerkung: str


class RaumtypNeu(BaseModel):
    bezeichnung: str = Field(min_length=1, max_length=200)
    theta_int: float | None = Field(default=None, ge=0, le=40)
    luftwechsel: float | None = Field(default=None, ge=0, le=10)
    reduktionsfaktor: float | None = Field(default=None, ge=-1, le=1.5)
    quelle: str = ""
    bemerkung: str = ""
    reihenfolge: int = 0
    richtwert_altbau_w_m2: float | None = Field(default=None, ge=0, le=500)


class RaumtypAenderung(RaumtypNeu):
    bezeichnung: str | None = Field(default=None, min_length=1, max_length=200)
    reihenfolge: int | None = None


class RaumtypLesen(Lesbar):
    id: int
    bezeichnung: str
    theta_int: float | None
    luftwechsel: float | None
    reduktionsfaktor: float | None
    quelle: str
    bemerkung: str
    reihenfolge: int
    richtwert_altbau_w_m2: float | None


class RegelLesen(Lesbar):
    schluessel: str
    bezeichnung: str
    wert: float | None
    wert_text: str
    einheit: str
    erlaeuterung: str
    quelle: str
    reihenfolge: int


class RegelAenderung(BaseModel):
    wert: float | None = Field(default=None, ge=0, le=1000)
    wert_text: str | None = Field(default=None, max_length=200)
    quelle: str | None = Field(default=None, max_length=500)


class ModulLesen(Lesbar):
    id: int
    artikel_nr: str
    bezeichnung: str
    leistung_w: float
    laenge_mm: float
    breite_mm: float
    bauhoehe_mm: float | None
    gewicht_kg: float | None
    schutzart: str
    bad_geeignet: bool
    oberflaeche: str
    ek_netto: float | None
    vk_netto: float | None
    montagezeit_min: float | None
    quelle: str
    bemerkung: str
    aktiv: bool


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


class PauschaleSetzen(BaseModel):
    raumtyp_id: int
    gebaeudestandard: Gebaeudestandard
    # None entfernt den Tabellenwert (dann gilt der Rückfallwert)
    w_m2: float | None = Field(default=None, ge=0, le=500)
    quelle: str = ""


class PauschaleLesen(Lesbar):
    raumtyp_id: int
    gebaeudestandard: Gebaeudestandard
    w_m2: float
    quelle: str


class FachvorgabenWerte(BaseModel):
    rueckfall_neubau_w_m2: float | None = Field(default=None, ge=0, le=500)
    rueckfall_effizienzhaus_sanierung_w_m2: float | None = Field(default=None, ge=0, le=500)
    hoehe_hinweis_m: float | None = Field(default=None, ge=0, le=20)
    delta_u_wb: float | None = Field(default=None, ge=0, le=1)
    quelle: str = ""


class FachvorgabenLesen(FachvorgabenWerte, Lesbar):
    geaendert_am: datetime


class FachvorgabenGesamt(BaseModel):
    werte: FachvorgabenLesen
    raumtypen: list[RaumtypLesen]
    pauschalen: list[PauschaleLesen]
    regeln: list[RegelLesen]
    gebaeudestandards: dict[str, str]


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


# ── Offline-Betrieb ─────────────────────────────────────────────────────────


class FlaechePaket(FlaecheLesen):
    oeffnungen: list[OeffnungLesen]


class RaumPaket(RaumLesen):
    flaechen: list[FlaechePaket]


class GeschossPaket(GeschossLesen):
    raeume: list[RaumPaket]


class ObjektPaket(ObjektLesen):
    geschosse: list[GeschossPaket]


class ProjektPaket(ProjektLesen):
    """Vollständiger Projektstand für den Offline-Speicher des Geräts, mit den eingefrorenen Fachvorgaben."""

    objekte: list[ObjektPaket]
    vorgaben_stand: dict | None


class OfflineVorgaben(BaseModel):
    """Schnappschuss aller Fachvorgaben und Bibliotheken für das Rechnen ohne Netz."""

    stand: datetime
    fachvorgaben: FachvorgabenGesamt
    bauteile: list[BauteilLesen]
    klimadaten: list[KlimadatenLesen]
    # Modulkatalog (nur aktive Module) für Modulauswahl und Platzierung ohne Netz
    module: list[ModulLesen] = []


# ── Eingefrorene Fachvorgaben je Projekt ────────────────────────────────────


class VorgabenUnterschied(BaseModel):
    bereich: Literal["Einzelwert", "Raumtyp", "Pauschale", "Platzierungsregel"]
    bezeichnung: str
    alt: float | str | None
    neu: float | str | None


class RaumAuswirkung(BaseModel):
    raum_id: int
    bezeichnung: str
    alt_w: float | None
    neu_w: float | None


class VorgabenAuswirkung(BaseModel):
    """Summe der maßgeblichen Raumheizlasten mit dem Projektstand (alt) und den aktuellen zentralen Vorgaben (neu)."""

    summe_alt_w: float
    summe_neu_w: float
    raeume: list[RaumAuswirkung]


class ProjektVorgaben(BaseModel):
    """Die Fachvorgaben, mit denen das Projekt rechnet, und was sich zentral seitdem geändert hat."""

    stand_am: datetime | None
    # gleicher Aufbau wie FachvorgabenGesamt (werte, raumtypen, pauschalen, gebaeudestandards)
    vorgaben: dict
    # alle Unterschiede zum aktuellen zentralen Stand (auch bewusst abgelehnte)
    unterschiede: list[VorgabenUnterschied]
    auswirkung: VorgabenAuswirkung | None
    # True: der Fachprüfer muss noch übernehmen oder ablehnen; bis dahin kein Angebot
    offen: bool = False
    # wann der Fachprüfer den aktuellen zentralen Stand zuletzt bewusst abgelehnt hat
    abgelehnt_am: datetime | None = None


class VorgabenAblehnen(BaseModel):
    # Begründung des Fachprüfers, warum das Projekt bei seinem Stand bleibt (optional, protokolliert)
    bemerkung: str = Field(default="", max_length=500)
