"""Gemeinsame Berichtsdaten (Paket M4): Firma, Projekt, Räume mit Rechenkern-Ergebnis und Planungsdaten.

Heizlast, installierte Leistung, Reserve, Status je Raum, Summen und Umriss kommen ausschließlich aus dem Rechenkern
(app/auswertung.py → rechenkern); hier wird nur zusammengestellt und formatiert. Preise kommen hier nie vor.
"""
import re
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.orm import Session

from app.auswertung import objekt_auswerten
from app.models import Benutzer, Firma, Projekt, Raum
from app.routers.firmen import berichtsfirma
from app.vorgabenstand import projekt_stand

STATUS_TEXT = {"entwurf": "Vor-Ort-Entwurf", "geprueft": "fachlich geprüft", "freigegeben": "freigegeben"}
RAUMSTATUS_TEXT = {"ok": "OK", "pruefen": "Prüfen", "unterdeckt": "Unterdeckt", None: "keine Module"}
STANDARD_TEXT = {"neubau": "Neubau", "effizienzhaus_sanierung": "Effizienzhaus-Sanierung", "sonstiger_bestand": "Altbau (nicht Effizienzhaus)"}
QUELLE_TEXT = {"A": "Pauschale (A)", "B": "Hottgenroth (B)", "C": "vereinfachte Berechnung (C)"}
HERKUNFT_TEXT = {"raum": "je Raum festgelegt", "projekt": "Projektvorgabe", "vorgabe": "Fachvorgaben", "rueckfall": "Rückfallwert"}

HINWEISE_ALLGEMEIN = (
    "Möbel und Sperrflächen laut Aufnahme vor Ort – vom Kunden zu bestätigen.",
    "Eine Änderung der Möblierung erfordert eine neue Prüfung der Modulplatzierung.",
)


@dataclass
class RaumBericht:
    nr: int
    raum: Raum
    a: dict  # Rechenkern-Auswertung des Raums
    geschoss: str


@dataclass
class BerichtDaten:
    projekt: Projekt
    firma: Firma | None
    standard_text: str
    objekt_bezeichnung: str
    zustaendig: str
    stand_am: datetime | None
    status_text: str
    raeume: list[RaumBericht]
    summe: dict
    regeln: dict = field(default_factory=dict)
    objekte: dict = field(default_factory=dict)
    hoehe_hinweis_m: float | None = None
    pruefvermerk: str = ""


def _name(db: Session, benutzer_id: int | None) -> str | None:
    b = db.get(Benutzer, benutzer_id) if benutzer_id else None
    return b.name if b else None


def datum(d: datetime | None) -> str:
    return d.astimezone().strftime("%d.%m.%Y") if d else "–"


def sammeln(db: Session, projekt: Projekt) -> BerichtDaten:
    objekt = projekt.objekte[0]
    planung, auswertung = objekt_auswerten(db, objekt)
    raeume_db = {r.id: r for g in objekt.geschosse for r in g.raeume}
    raeume = [RaumBericht(i + 1, raeume_db[a["raum_id"]], a, a["geschoss"]) for i, a in enumerate(auswertung["raeume"])]
    stand = projekt_stand(db, projekt)
    if projekt.status == "freigegeben":
        vermerk = f"Freigegeben von {_name(db, projekt.freigegeben_von_id) or '–'} am {datum(projekt.freigegeben_am)}"
        if projekt.geprueft_am:
            vermerk = f"Fachlich geprüft von {_name(db, projekt.geprueft_von_id) or '–'} am {datum(projekt.geprueft_am)}; {vermerk}"
    elif projekt.status == "geprueft":
        vermerk = f"Fachlich geprüft von {_name(db, projekt.geprueft_von_id) or '–'} am {datum(projekt.geprueft_am)}"
    else:
        vermerk = "Noch nicht fachlich geprüft (Vor-Ort-Entwurf)."
    return BerichtDaten(
        projekt=projekt,
        firma=berichtsfirma(db, projekt),
        standard_text=STANDARD_TEXT.get(objekt.gebaeudestandard, objekt.gebaeudestandard),
        objekt_bezeichnung=objekt.bezeichnung,
        zustaendig=projekt.zugewiesen_an_name or projekt.ersteller_name or "–",
        stand_am=projekt.vorgaben_stand_am,
        status_text=STATUS_TEXT.get(projekt.status, projekt.status),
        raeume=raeume,
        summe=auswertung["summe"],
        regeln={r["schluessel"]: r for r in stand.get("regeln", [])},
        objekte={o["schluessel"]: o for o in stand.get("objekte", [])},
        hoehe_hinweis_m=(stand.get("werte") or {}).get("hoehe_hinweis_m"),
        pruefvermerk=vermerk,
    )


def raumstatus(a: dict) -> str:
    return RAUMSTATUS_TEXT.get((a.get("modulplanung") or {}).get("bericht_status"), "keine Module")


def raumhinweise(d: BerichtDaten, rb: RaumBericht) -> list[str]:
    """Hinweise je Raum für den Ergebnisbericht (Paket M4a)."""
    a, m = rb.a, rb.a.get("modulplanung") or {}
    liste = []
    if (a.get("raumtyp") or "").lower().startswith("bad"):
        liste.append("Bad: nur Module mit Schutzart IP44 oder höher; Schutzbereiche nach DIN VDE 0100-701 durch eine Elektrofachkraft prüfen.")
    if m.get("bericht_status") == "pruefen":
        liste.append(f"Reserve {zahl(m.get('reserve_prozent'), 0)} % (über 20 %): Begründung angeben, z. B. kleinstes passendes Modul oder Modulraster.")
    if m.get("bericht_status") == "unterdeckt":
        liste.append("Unterdeckt: Die Modulleistung liegt unter der Heizlast – Planung prüfen.")
    if d.hoehe_hinweis_m is not None and (a.get("hoehe_m") or 0) >= d.hoehe_hinweis_m:
        liste.append(f"Raumhöhe ab {zahl(d.hoehe_hinweis_m)} m: Pauschale fachlich prüfen.")
    verstoesse = sum(len(v) for v in (m.get("verstoesse") or {}).values())
    if verstoesse:
        liste.append(f"{verstoesse} Regelverstoß/-verstöße im Deckenplan – vor dem Angebot klären.")
    return liste


def zahl(w: float | None, stellen: int = 2) -> str:
    if w is None:
        return "–"
    text = f"{w:,.{stellen}f}"
    return text.replace(",", "§").replace(".", ",").replace("§", ".")


def watt(w: float | None) -> str:
    return "–" if w is None else f"{zahl(w, 0)} W"


def dateiname(art: str, projekt: Projekt, endung: str) -> str:
    """Ergebnisbericht_<Projektnr>_<Kunde>.pdf usw. (Umlaute bleiben, Sonderzeichen werden ersetzt)."""
    def sauber(t: str) -> str:
        return re.sub(r"[^0-9A-Za-zÄÖÜäöüß-]+", "_", t).strip("_")
    teile = [art, sauber(projekt.nummer)] + ([sauber(projekt.kunde_name)] if projekt.kunde_name.strip() else [])
    return "_".join(teile) + f".{endung}"


def stueckliste(d: BerichtDaten, mit_pauschalen: bool = False) -> list[dict]:
    """Blattstückliste je Raum: Module (je Typ), Raumthermostat; mit_pauschalen: Elektroanschluss je Raum, Anfahrt.

    Mengen aus dem Rechenkern (modulplanung.typen, thermostate)."""
    zeilen = []
    for rb in d.raeume:
        m = rb.a.get("modulplanung") or {}
        if not m.get("anzahl"):
            continue
        for t in m.get("typen") or []:
            zeilen.append({"raum_nr": rb.nr, "raum": rb.a["bezeichnung"], "geschoss": rb.geschoss, "schluessel": f"modul:{t['artikel_nr']}",
                           "art_nr": t["artikel_nr"], "artikel": t["bezeichnung"], "leistung_w": t["leistung_w"], "menge": t["anzahl"], "einheit": "Stück"})
        if m.get("thermostate"):
            zeilen.append({"raum_nr": rb.nr, "raum": rb.a["bezeichnung"], "geschoss": rb.geschoss, "schluessel": "raumthermostat",
                           "art_nr": "", "artikel": "Raumthermostat", "leistung_w": None, "menge": m["thermostate"], "einheit": "Stück"})
        if mit_pauschalen:
            zeilen.append({"raum_nr": rb.nr, "raum": rb.a["bezeichnung"], "geschoss": rb.geschoss, "schluessel": "elektroanschluss",
                           "art_nr": "", "artikel": "Elektroanschluss-Pauschale", "leistung_w": None, "menge": 1, "einheit": "Pauschale"})
    if mit_pauschalen and zeilen:
        zeilen.append({"raum_nr": 0, "raum": "Projekt", "geschoss": "", "schluessel": "anfahrt", "art_nr": "", "artikel": "Anfahrt",
                       "leistung_w": None, "menge": 1, "einheit": "Pauschale"})
    return zeilen


def firmenzeilen(f: Firma | None) -> tuple[str, str]:
    """Fußzeile: Anschrift/Kontakt, zweite Zeile Geschäftsführer, Handelsregister, USt-IdNr. (leere Angaben entfallen)."""
    if f is None:
        return "", ""
    name = f"{f.name}{' ' + f.rechtsform if f.rechtsform and f.rechtsform not in f.name else ''}"
    ort = " ".join(x for x in (f.plz, f.ort) if x)
    zeile1 = " · ".join(x for x in (name, f.strasse, ort, f.telefon and f"Tel. {f.telefon}", f.email, f.web) if x)
    zeile2 = " · ".join(x for x in (f.geschaeftsfuehrer and f"Geschäftsführer: {f.geschaeftsfuehrer}", f.handelsregister,
                                     f.ust_idnr and f"USt-IdNr. {f.ust_idnr}") if x)
    return zeile1, zeile2
