"""Excel-Export und -Import für alle Tabellen der Fachvorgaben (Paket L, app/tabellen_excel.py). Nur Fachprüfer und Admin.

Der Modulkatalog nutzt seinen bisherigen Import (app/modul_import.py) über dieselben Adressen und dasselbe Antwortformat.
"""
from typing import Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.abhaengigkeiten import aktueller_benutzer, vorgaben_pflege
from app.models import Benutzer
from app.db import get_db
from app.modul_import import ImportAbgelehnt as KatalogAbgelehnt, uebernehmen as katalog_uebernehmen, vorschau as katalog_vorschau
from app.modulabgleich import abgleichen as module_abgleichen
from app.routers.bibliotheken import PREISFELDER, _excel_lesen, module_export
from app.schemas import TabellenImportErgebnis, TabellenImportVorschau
from app.sicherung import SicherungFehler, datenbank_sichern
from app.tabellen_excel import TABELLEN, ImportAbgelehnt, auswirkung, exportieren, uebernehmen, vorschau
from app.vorgabenabgleich import abgleichen

router = APIRouter(prefix="/tabellen", tags=["Excel"], dependencies=[Depends(aktueller_benutzer), Depends(vorgaben_pflege)])

Name = Literal["raumtypen", "regeln", "objekte", "bauteile", "klimadaten", "module"]
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _abgelehnt(fehler: Exception) -> HTTPException:
    liste = getattr(fehler, "fehler", [])
    detail = str(fehler) + ("" if not liste else " " + "; ".join(f"Zeile {f['zeile']}: {f['text']}" for f in liste[:5]))
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail)


def _katalog_allgemein(v: dict) -> dict:
    """Antwort des Katalogimports im allgemeinen Format (Schlüssel statt Artikel-Nr.)."""
    return {
        **{k: v[k] for k in ("neu", "geaendert", "unveraendert", "pruefsumme")},
        "aenderungen": [{**{k: a[k] for k in ("zeile", "feld", "feldname", "alt", "neu")}, "schluessel": a["artikel_nr"]} for a in v["aenderungen"]],
        "fehler": [{"zeile": f["zeile"], "schluessel": f["artikel_nr"], "text": f["text"]} for f in v["fehler"]],
        "betroffen": [],
    }


@router.get("/{name}/export.xlsx")
def export(name: Name, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    """Alle Felder (auch die in der Tabelle ausgeblendeten) mit Hinweisblatt; Preise nur mit Recht „Kalkulation sehen“."""
    if name == "module":
        return module_export(db, mit_preisen=benutzer.darf_kalkulation)
    inhalt, datei = exportieren(db, TABELLEN[name])
    return Response(inhalt, media_type=XLSX, headers={"Content-Disposition": f'attachment; filename="{datei}"'})


@router.post("/{name}/import/vorschau", response_model=TabellenImportVorschau)
async def import_vorschau(name: Name, datei: UploadFile, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    """Schritt 1: prüfen, Änderungen und betroffene Projekte zeigen – nichts wird gespeichert."""
    inhalt = await _excel_lesen(datei)
    try:
        if name == "module":
            return _katalog_allgemein(katalog_vorschau(db, inhalt, ohne=() if benutzer.darf_kalkulation else PREISFELDER))
        t = TABELLEN[name]
        v = vorschau(db, t, inhalt)
        v["betroffen"] = auswirkung(db, t, v)
        return v
    except (ImportAbgelehnt, KatalogAbgelehnt) as fehler:
        raise _abgelehnt(fehler) from None


@router.post("/{name}/import", response_model=TabellenImportErgebnis)
async def import_uebernehmen(name: Name, datei: UploadFile, pruefsumme: str = Form(...), db: Session = Depends(get_db),
                             benutzer: Benutzer = Depends(aktueller_benutzer)):
    """Schritt 2: nach Bestätigung übernehmen – nur fehlerfrei, vorher Datenbanksicherung, danach Abgleich der Projekte."""
    inhalt = await _excel_lesen(datei)
    try:
        if name == "module":
            ohne = () if benutzer.darf_kalkulation else PREISFELDER
            katalog_vorschau(db, inhalt, ohne=ohne)  # vor der Sicherung prüfen
            sicherung = datenbank_sichern("vor_import_module")
            ergebnis = katalog_uebernehmen(db, inhalt, pruefsumme, ohne=ohne)
        else:
            t = TABELLEN[name]
            if vorschau(db, t, inhalt)["fehler"]:
                raise ImportAbgelehnt("Die Datei enthält Fehler – nichts übernommen. Bitte erneut prüfen.")
            sicherung = datenbank_sichern(f"vor_import_{name}")
            ergebnis = uebernehmen(db, t, inhalt, pruefsumme)
    except (ImportAbgelehnt, KatalogAbgelehnt) as fehler:
        db.rollback()
        raise _abgelehnt(fehler) from None
    except SicherungFehler as fehler:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"{fehler} – Import nicht durchgeführt.") from None
    db.commit()
    benutzer_id = db.info.get("benutzer_id")
    if name == "module":
        warten = len(module_abgleichen(db, benutzer_id)["betroffen"])
    elif TABELLEN[name].vorgaben:
        warten = len(abgleichen(db, benutzer_id)["betroffen"])
    else:
        warten = 0
    return TabellenImportErgebnis(**ergebnis, sicherung=sicherung, projekte_warten=warten)
