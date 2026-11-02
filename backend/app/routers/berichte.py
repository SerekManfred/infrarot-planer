"""Berichte je Projekt (Paket M4, 02.11.2026) – serverseitig erzeugt, Sichtbarkeit wie beim Projekt.

- Ergebnisbericht (PDF, ohne Preise) und Bestellliste (Excel, ohne Preise): alle, die das Projekt sehen dürfen.
- Kalkulation intern (Excel): nur mit Recht „Kalkulation sehen“ (Standard: nur Admin). Der Preisstand wird beim
  ersten Erzeugen je Projekt eingefroren und nur bewusst aktualisiert.
- Artikelstamm für Pauschalen (Raumthermostat, Elektroanschluss, Anfahrt): lesen mit Recht, Preise pflegt der Admin.
"""
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404, rolle
from app.berichte import excel, pdf
from app.berichte.daten import dateiname, sammeln
from app.db import get_db
from app.models import Artikel, Benutzer, BibModul, Projekt
from app.schemas import ArtikelAenderung, ArtikelLesen

router = APIRouter(tags=["Berichte"], dependencies=[Depends(aktueller_benutzer)])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _datei(inhalt: bytes, name: str, art: str) -> Response:
    ascii_name = name.encode("ascii", "replace").decode().replace("?", "_")
    return Response(inhalt, media_type=art, headers={
        "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "no-store",
    })


def _darf_kalkulation(benutzer: Benutzer) -> None:
    if not benutzer.darf_kalkulation:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Die Kalkulation sehen nur Benutzer mit dem Recht „Kalkulation sehen“.")


@router.get("/projekte/{projekt_id}/berichte/ergebnis.pdf")
def ergebnisbericht(projekt_id: int, db: Session = Depends(get_db)):
    projekt = hole_oder_404(db, Projekt, projekt_id)  # prüft auch die Sichtbarkeit
    return _datei(pdf.erzeugen(sammeln(db, projekt)), dateiname("Ergebnisbericht", projekt, "pdf"), "application/pdf")


@router.get("/projekte/{projekt_id}/berichte/bestellliste.xlsx")
def bestellliste(projekt_id: int, db: Session = Depends(get_db)):
    projekt = hole_oder_404(db, Projekt, projekt_id)
    return _datei(excel.bestellliste(sammeln(db, projekt)), dateiname("Bestellliste", projekt, "xlsx"), XLSX)


def katalogversion(db: Session) -> str:
    stand = max(filter(None, (db.scalar(select(func.max(BibModul.geaendert_am))), db.scalar(select(func.max(Artikel.geaendert_am))))), default=None)
    return stand.astimezone().strftime("%Y-%m-%d %H:%M") if stand else "–"


def preisstand_erzeugen(db: Session) -> dict:
    """Aktuelle Preise aller Module und Pauschal-Artikel (leer = Preis fehlt)."""
    preise = {
        f"modul:{m.artikel_nr}": {"art_nr": m.artikel_nr, "bezeichnung": m.bezeichnung, "einheit": "Stück", "ek": m.ek_netto, "vk": m.vk_netto}
        for m in db.scalars(select(BibModul))
    }
    for a in db.scalars(select(Artikel).order_by(Artikel.reihenfolge)):
        preise[a.schluessel] = {"art_nr": a.art_nr, "bezeichnung": a.bezeichnung, "einheit": a.einheit, "ek": a.ek_netto, "vk": a.vk_netto}
    return {"datum": datetime.now().astimezone().strftime("%d.%m.%Y %H:%M"), "katalogversion": katalogversion(db), "preise": preise}


@router.get("/projekte/{projekt_id}/berichte/kalkulation.xlsx")
def kalkulation(projekt_id: int, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    _darf_kalkulation(benutzer)
    projekt = hole_oder_404(db, Projekt, projekt_id)
    if projekt.preisstand is None:  # beim ersten Erzeugen einfrieren
        projekt.preisstand = preisstand_erzeugen(db)
        db.commit()
        db.refresh(projekt)
    inhalt = excel.kalkulation(sammeln(db, projekt), projekt.preisstand)
    return _datei(inhalt, dateiname("Kalkulation_intern", projekt, "xlsx"), XLSX)


@router.get("/projekte/{projekt_id}/preisstand")
def preisstand_lesen(projekt_id: int, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    _darf_kalkulation(benutzer)
    projekt = hole_oder_404(db, Projekt, projekt_id)
    ps = projekt.preisstand
    return {"eingefroren": ps is not None, "datum": ps and ps.get("datum"), "katalogversion": ps and ps.get("katalogversion"),
            "aktuelle_katalogversion": katalogversion(db)}


@router.post("/projekte/{projekt_id}/preisstand")
def preisstand_aktualisieren(projekt_id: int, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    """Preisstand bewusst auf die aktuellen Preise setzen (protokolliert als Projektänderung)."""
    _darf_kalkulation(benutzer)
    projekt = hole_oder_404(db, Projekt, projekt_id)
    projekt.preisstand = preisstand_erzeugen(db)
    db.commit()
    return preisstand_lesen(projekt_id, db, benutzer)


@router.get("/artikel", response_model=list[ArtikelLesen])
def artikel(db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    _darf_kalkulation(benutzer)
    return db.scalars(select(Artikel).order_by(Artikel.reihenfolge)).all()


@router.patch("/artikel/{schluessel}", response_model=ArtikelLesen, dependencies=[Depends(rolle("admin"))])
def artikel_aendern(schluessel: str, daten: ArtikelAenderung, db: Session = Depends(get_db)):
    a = db.get(Artikel, schluessel)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artikel nicht gefunden")
    for name, wert in daten.model_dump(exclude_unset=True).items():
        setattr(a, name, wert if wert is not None or name in ("ek_netto", "vk_netto") else getattr(a, name))
    db.commit()
    db.refresh(a)
    return a
