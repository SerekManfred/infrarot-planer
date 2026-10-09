"""CSV-Import für die Bibliotheken. Format: docs/CSV-FORMATE.md

Grundsätze:
- Semikolon als Trenner, UTF-8 (BOM erlaubt), erste Zeile = Spaltenköpfe.
- Dezimalkomma oder Dezimalpunkt.
- Jede Zeile braucht eine Quelle – es gibt keine Werte ohne Herkunft.
- Alles oder nichts: Enthält die Datei einen Fehler, wird nichts importiert.
- Vorhandene Einträge (gleicher Schlüssel) werden aktualisiert.
"""
import csv
import io
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BibBauteil, BibKlimadaten, BibRaumtyp

BibliothekArt = Literal["bauteile", "raumtypen", "klimadaten"]


@dataclass(frozen=True)
class Spalte:
    name: str
    typ: type = str
    pflicht: bool = True
    # Plausibilitätsgrenzen, nur gegen Tipp- und Einheitenfehler – keine Normwerte
    min: float | None = None
    max: float | None = None


@dataclass(frozen=True)
class Format:
    model: type
    spalten: tuple[Spalte, ...]
    schluessel: tuple[str, ...]


FORMATE: dict[str, Format] = {
    "bauteile": Format(
        BibBauteil,
        (
            Spalte("kategorie"),
            Spalte("bezeichnung"),
            Spalte("baualtersklasse", pflicht=False),
            Spalte("u_wert", float, min=0.01, max=10),
            Spalte("quelle"),
            Spalte("bemerkung", pflicht=False),
        ),
        ("kategorie", "bezeichnung", "baualtersklasse"),
    ),
    "raumtypen": Format(
        BibRaumtyp,
        (
            Spalte("bezeichnung"),
            Spalte("theta_int", float, min=0, max=40),
            Spalte("luftwechsel", float, min=0, max=10),
            Spalte("quelle"),
            Spalte("bemerkung", pflicht=False),
        ),
        ("bezeichnung",),
    ),
    "klimadaten": Format(
        BibKlimadaten,
        (
            Spalte("plz", pflicht=False),
            Spalte("ort"),
            Spalte("theta_e", float, min=-40, max=10),
            Spalte("theta_m_e", float, pflicht=False, min=-10, max=25),
            Spalte("quelle"),
        ),
        ("plz", "ort"),
    ),
}


@dataclass
class Ergebnis:
    zeilen: list[dict] = field(default_factory=list)
    fehler: list[str] = field(default_factory=list)


def _zahl(text: str) -> float:
    return float(text.strip().replace(" ", "").replace(",", "."))


def lese_csv(art: str, text: str) -> Ergebnis:
    """Prüft und wandelt den CSV-Text; schreibt nichts in die Datenbank."""
    fmt = FORMATE[art]
    ergebnis = Ergebnis()
    leser = csv.DictReader(io.StringIO(text.lstrip("﻿")), delimiter=";")
    koepfe = [k.strip().lower() for k in (leser.fieldnames or [])]
    erwartet = [s.name for s in fmt.spalten]
    fehlend = [s.name for s in fmt.spalten if s.pflicht and s.name not in koepfe]
    unbekannt = [k for k in koepfe if k not in erwartet]
    if fehlend or unbekannt:
        if fehlend:
            ergebnis.fehler.append(f"Fehlende Spalten: {', '.join(fehlend)}")
        if unbekannt:
            ergebnis.fehler.append(f"Unbekannte Spalten: {', '.join(unbekannt)}")
        ergebnis.fehler.append(f"Erwartet: {';'.join(erwartet)}")
        return ergebnis
    leser.fieldnames = koepfe

    gesehen: dict[tuple, int] = {}
    for zeile_nr, roh in enumerate(leser, start=2):
        if not any((v or "").strip() for v in roh.values() if isinstance(v, str)):
            continue  # Leerzeile
        if None in roh:
            ergebnis.fehler.append(f"Zeile {zeile_nr}: mehr Werte als Spalten")
            continue
        datensatz: dict = {}
        for spalte in fmt.spalten:
            wert = (roh.get(spalte.name) or "").strip()
            if not wert:
                if spalte.pflicht:
                    ergebnis.fehler.append(f"Zeile {zeile_nr}: „{spalte.name}“ fehlt")
                datensatz[spalte.name] = None if spalte.typ is float else ""
                continue
            if spalte.typ is float:
                try:
                    zahl = _zahl(wert)
                except ValueError:
                    ergebnis.fehler.append(f"Zeile {zeile_nr}: „{spalte.name}“ ist keine Zahl: {wert}")
                    continue
                if (spalte.min is not None and zahl < spalte.min) or (spalte.max is not None and zahl > spalte.max):
                    ergebnis.fehler.append(
                        f"Zeile {zeile_nr}: „{spalte.name}“ = {zahl} außerhalb von {spalte.min} … {spalte.max}"
                    )
                    continue
                datensatz[spalte.name] = zahl
            else:
                datensatz[spalte.name] = wert
        schluessel = tuple(datensatz.get(s) for s in fmt.schluessel)
        if schluessel in gesehen:
            ergebnis.fehler.append(f"Zeile {zeile_nr}: doppelt (wie Zeile {gesehen[schluessel]})")
            continue
        gesehen[schluessel] = zeile_nr
        ergebnis.zeilen.append(datensatz)

    if not ergebnis.zeilen and not ergebnis.fehler:
        ergebnis.fehler.append("Datei enthält keine Datenzeilen")
    return ergebnis


def importiere(db: Session, art: str, text: str) -> tuple[int, int, list[str]]:
    """Importiert nach erfolgreicher Prüfung; gibt (neu, aktualisiert, fehler) zurück."""
    gelesen = lese_csv(art, text)
    if gelesen.fehler:
        return 0, 0, gelesen.fehler
    fmt = FORMATE[art]
    neu = aktualisiert = 0
    for datensatz in gelesen.zeilen:
        bedingung = [getattr(fmt.model, s) == datensatz[s] for s in fmt.schluessel]
        vorhanden = db.scalars(select(fmt.model).where(*bedingung)).one_or_none()
        if vorhanden is None:
            db.add(fmt.model(**datensatz))
            neu += 1
        else:
            for name, wert in datensatz.items():
                setattr(vorhanden, name, wert)
            aktualisiert += 1
    db.commit()
    return neu, aktualisiert, []
