"""Projekte, Projektstatus und Änderungsprotokoll.

Sichtbarkeit (31.10.2026): Fachprüfer und Admins sehen alle Projekte; Benutzer mit nur der Rolle Außendienst nur
eigene und ihnen zugewiesene (app/projektzugriff.py). Zuweisen und die Projektnummer ändern dürfen nur Admins.
Die Projektnummer vergibt der Server fortlaufend je Jahr (z. B. 2026-0004).
Den Status ändern nur Fachprüfer; löschen dürfen nur Admins. Freigegebene Projekte sind gesperrt (app/projektzugriff.py).
Zur Offline-Bearbeitung checkt ein Gerät ein Projekt aus; solange ist es für alle anderen gesperrt.
Einchecken kann das Gerät selbst; ein Admin kann die Sperre lösen.
Jedes Projekt rechnet mit seiner Kopie der Fachvorgaben (app/vorgabenstand.py); neue zentrale Werte werden
nur auf Klick übernommen. Übernehmen oder bewusst ablehnen darf nur der Fachprüfer; bis dahin ist kein Angebot
möglich (Projekt.vorgaben_offen).
Altbau-Projekte mit Räumen ohne W/m²-Wert „warten auf den Fachprüfer“ (Projekt.wartet_auf_fachpruefer): Sie können
nicht als geprüft markiert werden und sind damit auch für Angebote gesperrt.
"""
import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
import re

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.abhaengigkeiten import aktueller_benutzer, hole_oder_404, nur_admin, nur_fachpruefer
from app.auswertung import objekt_auswerten
from app.vorgabenabgleich import vergleich
from app.vorgabenstand import mit_texten, offene_unterschiede, projekt_stand, schnappschuss, unterschiede
from app.db import get_db
from app.models import Benutzer, Berechnung, Objekt, Projekt, Protokoll
from app.projektzugriff import bearbeitung_pruefen, haelt_sperre, sichtbarkeit_filter, sichtbarkeit_pruefen, sperre_hash, sperre_pruefen
from app.schemas import (
    Auschecken, AuscheckenAntwort, ProjektAenderung, ProjektDetail, ProjektLesen, ProjektNeu, ProjektVorgaben,
    ModulAbgleich, ProtokollLesen, StatusAenderung, VorgabenAblehnen, Zuweisung,
)
from app.modulabgleich import (
    ablehnen as modul_ablehnen, auswirkung as module_auswirkung, katalog as modulkatalog,
    offene_unterschiede as module_offen_liste, uebernehmen as modul_uebernehmen, unterschiede as module_unterschiede,
)

router = APIRouter(prefix="/projekte", tags=["Projekte"], dependencies=[Depends(aktueller_benutzer)])

# Erlaubte Statuswechsel (nur Fachprüfer)
UEBERGAENGE = {
    ("entwurf", "geprueft"),
    ("geprueft", "freigegeben"),
    ("geprueft", "entwurf"),
    ("freigegeben", "entwurf"),
}


@router.get("", response_model=list[ProjektLesen])
def auflisten(db: Session = Depends(get_db)):
    return db.scalars(
        select(Projekt).where(sichtbarkeit_filter(db)).order_by(Projekt.geaendert_am.desc(), Projekt.id.desc())
    ).all()


def naechste_nummer(db: Session, jahr: int) -> str:
    """Fortlaufende Projektnummer je Jahr: JJJJ-NNNN (z. B. 2026-0004)."""
    muster = re.compile(rf"^{jahr}-(\d{{4,}})$")
    hoechste = max(
        (int(t.group(1)) for n in db.scalars(select(Projekt.nummer).where(Projekt.nummer.like(f"{jahr}-%")))
         if (t := muster.match(n))),
        default=0,
    )
    return f"{jahr}-{hoechste + 1:04d}"


def nummer_frei_pruefen(db: Session, nummer: str, ausser: int | None = None) -> None:
    vorhanden = db.scalar(select(Projekt.id).where(Projekt.nummer == nummer))
    if vorhanden is not None and vorhanden != ausser:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Projektnummer {nummer} ist bereits vergeben")


@router.post("", response_model=ProjektDetail, status_code=status.HTTP_201_CREATED)
def anlegen(daten: ProjektNeu, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    werte = daten.model_dump(exclude={"nummer"})  # Nummer vergibt der Server
    gebaeude = {k: werte.pop(k) for k in ("gebaeudestandard", "strasse", "plz", "ort")}
    stand = schnappschuss(db)
    jetzt = datetime.now(UTC)
    for _versuch in range(5):  # gleichzeitiges Anlegen: bei doppelter Nummer die nächste nehmen
        # Fachvorgaben einfrieren: das Projekt rechnet ab jetzt mit dieser Kopie
        projekt = Projekt(
            **werte, nummer=naechste_nummer(db, jetzt.year), ersteller_id=benutzer.id, vorgaben_stand=stand,
            vorgaben_stand_am=jetzt,
        )
        projekt.objekte.append(Objekt(bezeichnung="Gebäude", **gebaeude))
        db.add(projekt)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
    else:
        raise HTTPException(status.HTTP_409_CONFLICT, "Projektnummer konnte nicht vergeben werden – bitte erneut versuchen")
    return lesen(projekt.id, db)


@router.get("/{projekt_id}", response_model=ProjektDetail)
def lesen(projekt_id: int, db: Session = Depends(get_db)):
    projekt = db.scalars(
        select(Projekt).where(Projekt.id == projekt_id).options(selectinload(Projekt.objekte))
    ).one_or_none()
    if projekt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projekt nicht gefunden – evtl. inzwischen gelöscht")
    sichtbarkeit_pruefen(db, projekt)
    db.refresh(projekt)
    return projekt


@router.patch("/{projekt_id}", response_model=ProjektLesen)
def aendern(
    projekt_id: int, daten: ProjektAenderung, db: Session = Depends(get_db),
    benutzer: Benutzer = Depends(aktueller_benutzer),
):
    projekt = hole_oder_404(db, Projekt, projekt_id)
    bearbeitung_pruefen(db, projekt)
    werte = daten.model_dump(exclude_unset=True)
    if "nummer" in werte and werte["nummer"] != projekt.nummer:
        if not benutzer.hat_rolle("admin"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Die Projektnummer wird automatisch vergeben; ändern darf sie nur ein Admin.")
        nummer_frei_pruefen(db, werte["nummer"], projekt.id)
    for name, wert in werte.items():
        setattr(projekt, name, wert)
    db.commit()
    db.refresh(projekt)
    return projekt


@router.put("/{projekt_id}/zuweisung", response_model=ProjektLesen)
def zuweisen(
    projekt_id: int, daten: Zuweisung, db: Session = Depends(get_db), _admin: Benutzer = Depends(nur_admin),
):
    """Admin weist das Projekt einem (anderen) Außendienst-Benutzer zu, z. B. als Urlaubsvertretung (protokolliert)."""
    projekt = hole_oder_404(db, Projekt, projekt_id)
    if daten.benutzer_id is not None:
        ziel = hole_oder_404(db, Benutzer, daten.benutzer_id)
        if not ziel.aktiv or not ziel.hat_rolle("aussendienst"):
            raise HTTPException(status.HTTP_409_CONFLICT, f"{ziel.name} ist kein aktiver Außendienst-Benutzer")
    projekt.zugewiesen_an_id = daten.benutzer_id
    db.commit()
    db.refresh(projekt)
    return projekt


@router.post("/{projekt_id}/status", response_model=ProjektLesen)
def status_aendern(
    projekt_id: int, daten: StatusAenderung, db: Session = Depends(get_db),
    pruefer: Benutzer = Depends(nur_fachpruefer),
):
    projekt = hole_oder_404(db, Projekt, projekt_id)
    sperre_pruefen(db, projekt)
    if (projekt.status, daten.status) not in UEBERGAENGE:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Statuswechsel {projekt.status} → {daten.status} nicht erlaubt")
    if daten.status != "entwurf" and projekt.wartet_auf_fachpruefer:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Altbau (nicht Effizienzhaus): Erst bei allen Räumen die W/m²-Pauschale festlegen, dann prüfen.",
        )
    if daten.status != "entwurf" and projekt.vorgaben_offen:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Die zentralen Fachvorgaben wurden geändert: Erst übernehmen oder bewusst ablehnen, dann prüfen.",
        )
    if daten.status != "entwurf" and projekt.module_offen:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Daten verwendeter Module wurden im Katalog geändert: Erst übernehmen oder bewusst ablehnen, dann prüfen.",
        )
    jetzt = datetime.now(UTC)
    # Ohne Zwischenspeichern, damit der Statuswechsel als ein Protokolleintrag erscheint
    with db.no_autoflush:
        if daten.status == "geprueft":
            projekt.geprueft_von_id, projekt.geprueft_am = pruefer.id, jetzt
        elif daten.status == "freigegeben":
            projekt.freigegeben_von_id, projekt.freigegeben_am = pruefer.id, jetzt
            # Auswertung einfrieren, damit spätere Vorgabenänderungen das freigegebene Ergebnis nicht verändern
            for objekt in projekt.objekte:
                eingabe, auswertung = objekt_auswerten(db, objekt)
                version = (db.scalar(
                    select(func.max(Berechnung.version)).where(Berechnung.objekt_id == objekt.id)) or 0) + 1
                db.add(Berechnung(
                    objekt_id=objekt.id, version=version, art="auswertung",
                    rechenkern_version=auswertung["rechenkern_version"], eingaben=eingabe, ergebnis=auswertung,
                    bemerkung=f"Freigabe {daten.bemerkung}".strip(), erstellt_von_id=pruefer.id,
                ))
        else:
            projekt.geprueft_von_id = projekt.geprueft_am = None
            projekt.freigegeben_von_id = projekt.freigegeben_am = None
        projekt.status = daten.status
    db.commit()
    db.refresh(projekt)
    return projekt


@router.post("/{projekt_id}/auschecken", response_model=AuscheckenAntwort)
def auschecken(
    projekt_id: int, daten: Auschecken, db: Session = Depends(get_db),
    benutzer: Benutzer = Depends(aktueller_benutzer),
):
    """Sperrt das Projekt für die Offline-Bearbeitung auf diesem Gerät. Erneutes Auschecken durch dasselbe Gerät
    (mit seinem Sperr-Token) behält die Sperre."""
    projekt = hole_oder_404(db, Projekt, projekt_id)
    if projekt.status == "freigegeben":
        raise HTTPException(status.HTTP_409_CONFLICT, "Freigegebene Projekte können nicht ausgecheckt werden.")
    if haelt_sperre(db, projekt):
        return AuscheckenAntwort(projekt=ProjektLesen.model_validate(projekt), sperre=db.info["sperre"])
    if projekt.ausgecheckt_am is not None:
        db.info["sperre"] = None
        sperre_pruefen(db, projekt)  # wirft 423 mit Angabe, wer das Projekt hat
    token = secrets.token_urlsafe(32)
    projekt.ausgecheckt_von_id = benutzer.id
    projekt.ausgecheckt_geraet = daten.geraet
    projekt.ausgecheckt_am = datetime.now(UTC)
    projekt.sperre_hash = sperre_hash(token)
    db.commit()
    db.refresh(projekt)
    return AuscheckenAntwort(projekt=ProjektLesen.model_validate(projekt), sperre=token)


@router.post("/{projekt_id}/einchecken", response_model=ProjektLesen)
def einchecken(projekt_id: int, db: Session = Depends(get_db), benutzer: Benutzer = Depends(aktueller_benutzer)):
    """Hebt die Offline-Sperre auf: durch das auscheckende Gerät oder durch einen Admin („Sperre lösen“)."""
    projekt = hole_oder_404(db, Projekt, projekt_id)
    if projekt.ausgecheckt_am is None:
        return projekt
    if not haelt_sperre(db, projekt) and not benutzer.hat_rolle("admin"):
        raise HTTPException(
            status.HTTP_423_LOCKED,
            f"Nur das Gerät „{projekt.ausgecheckt_geraet}“ von {projekt.ausgecheckt_von_name} "
            "oder ein Admin kann die Sperre aufheben.",
        )
    projekt.ausgecheckt_von_id = projekt.ausgecheckt_geraet = projekt.ausgecheckt_am = projekt.sperre_hash = None
    db.commit()
    db.refresh(projekt)
    return projekt


def _auswirkung(db: Session, projekt: Projekt, neu: dict) -> dict:
    """Auswirkung der aktuellen zentralen Vorgaben gegenüber dem Projektstand (app/vorgabenabgleich.py)."""
    stand = projekt_stand(db, projekt)
    ergebnis = vergleich(db, projekt, stand, neu)
    if ergebnis is not None:
        return ergebnis
    summe = sum(objekt_auswerten(db, o, stand)[1]["summe"]["phi_massgeblich_w"] for o in projekt.objekte)
    return {"summe_alt_w": summe, "summe_neu_w": summe, "raeume": [], "neue_verstoesse": 0}


@router.get("/{projekt_id}/vorgaben", response_model=ProjektVorgaben)
def vorgaben(projekt_id: int, db: Session = Depends(get_db)):
    """Fachvorgaben, mit denen das Projekt rechnet, und Unterschiede zu den aktuellen zentralen Vorgaben.
    Bei freigegebenen Projekten werden keine Unterschiede angeboten – sie bleiben unverändert."""
    projekt = hole_oder_404(db, Projekt, projekt_id)
    stand = projekt_stand(db, projekt)
    liste: list[dict] = []
    auswirkung = None
    offen = False
    if projekt.status != "freigegeben":
        neu = schnappschuss(db)
        liste = unterschiede(stand, neu)
        if liste:
            auswirkung = _auswirkung(db, projekt, neu)
            offen = bool(offene_unterschiede(db, projekt, neu))
    return ProjektVorgaben(
        stand_am=projekt.vorgaben_stand_am, vorgaben=mit_texten(stand), unterschiede=liste, auswirkung=auswirkung,
        offen=offen, abgelehnt_am=projekt.vorgaben_abgelehnt_am if liste and not offen else None,
    )


@router.post("/{projekt_id}/vorgaben/uebernehmen", response_model=ProjektVorgaben)
def vorgaben_uebernehmen(
    projekt_id: int, db: Session = Depends(get_db), benutzer: Benutzer = Depends(nur_fachpruefer)
):
    """Übernimmt die aktuellen zentralen Fachvorgaben in das Projekt – nur Fachprüfer, auf ausdrücklichen Klick,
    protokolliert."""
    projekt = hole_oder_404(db, Projekt, projekt_id)
    bearbeitung_pruefen(db, projekt)  # Sperre, Freigabe (409), geprüft → Entwurf
    alt = projekt_stand(db, projekt)
    neu = schnappschuss(db)
    liste = unterschiede(alt, neu)
    if not liste:
        return vorgaben(projekt_id, db)
    auswirkung = _auswirkung(db, projekt, neu)
    jetzt = datetime.now(UTC)
    db.add(Protokoll(
        zeitpunkt=jetzt, benutzer_id=benutzer.id, projekt_id=projekt.id, objektart="Projekt", objekt_id=projekt.id,
        aktion="vorgaben_uebernommen",
        aenderungen={
            "vorgaben_stand_am": [projekt.vorgaben_stand_am.isoformat() if projekt.vorgaben_stand_am else None,
                                  jetzt.isoformat()],
            "unterschiede": liste,
            "heizlast_summe_w": [auswirkung["summe_alt_w"], auswirkung["summe_neu_w"]],
        },
    ))
    projekt.vorgaben_stand = neu
    projekt.vorgaben_stand_am = jetzt
    projekt.vorgaben_abgelehnt = projekt.vorgaben_abgelehnt_am = None
    projekt.geaendert_am = jetzt
    db.commit()
    return vorgaben(projekt_id, db)


@router.post("/{projekt_id}/vorgaben/ablehnen", response_model=ProjektVorgaben)
def vorgaben_ablehnen(
    projekt_id: int, daten: VorgabenAblehnen | None = None, db: Session = Depends(get_db),
    benutzer: Benutzer = Depends(nur_fachpruefer),
):
    """Der Fachprüfer lehnt die aktuellen zentralen Fachvorgaben für dieses Projekt bewusst ab: Es rechnet weiter mit
    seinem Stand, und die Angebotssperre entfällt, bis zentral wieder etwas geändert wird. Protokolliert.
    Die Projektdaten selbst ändern sich nicht; ein geprüftes Projekt bleibt geprüft."""
    projekt = hole_oder_404(db, Projekt, projekt_id)
    sperre_pruefen(db, projekt)
    if projekt.status == "freigegeben":
        raise HTTPException(status.HTTP_409_CONFLICT, "Freigegebene Projekte bleiben ohnehin unverändert.")
    neu = schnappschuss(db)
    liste = offene_unterschiede(db, projekt, neu)
    if not liste:
        return vorgaben(projekt_id, db)
    jetzt = datetime.now(UTC)
    bemerkung = daten.bemerkung.strip() if daten else ""
    db.add(Protokoll(
        zeitpunkt=jetzt, benutzer_id=benutzer.id, projekt_id=projekt.id, objektart="Projekt", objekt_id=projekt.id,
        aktion="vorgaben_abgelehnt",
        aenderungen={"unterschiede": liste, **({"bemerkung": bemerkung} if bemerkung else {})},
    ))
    projekt.vorgaben_abgelehnt = neu
    projekt.vorgaben_abgelehnt_am = jetzt
    db.commit()
    return vorgaben(projekt_id, db)


@router.get("/{projekt_id}/module-abgleich", response_model=ModulAbgleich)
def module_abgleich(projekt_id: int, db: Session = Depends(get_db)):
    """Geänderte Katalogdaten der im Projekt verwendeten Module, mit Auswirkung (Festlegung 31.10.2026)."""
    projekt = hole_oder_404(db, Projekt, projekt_id)
    if projekt.status == "freigegeben":
        return ModulAbgleich(unterschiede=[], offen=False, auswirkung=None)
    kat = modulkatalog(db)
    offen = module_offen_liste(projekt, kat)
    liste = offen or module_unterschiede(projekt, kat)
    folge = module_auswirkung(db, projekt, kat, {u["modul_id"] for u in liste}) if liste else None
    return ModulAbgleich(unterschiede=liste, offen=bool(offen), auswirkung=folge)


@router.post("/{projekt_id}/module/uebernehmen", response_model=ModulAbgleich)
def module_uebernehmen(projekt_id: int, db: Session = Depends(get_db), benutzer: Benutzer = Depends(nur_fachpruefer)):
    """Aktuelle Katalogdaten in die platzierten Module übernehmen (nur Fachprüfer, protokolliert)."""
    projekt = hole_oder_404(db, Projekt, projekt_id)
    bearbeitung_pruefen(db, projekt)  # Sperre, Freigabe (409), geprüft → Entwurf
    modul_uebernehmen(db, projekt, benutzer.id)
    db.commit()
    return module_abgleich(projekt_id, db)


@router.post("/{projekt_id}/module/ablehnen", response_model=ModulAbgleich)
def module_ablehnen(
    projekt_id: int, daten: VorgabenAblehnen | None = None, db: Session = Depends(get_db),
    benutzer: Benutzer = Depends(nur_fachpruefer),
):
    """Bei den bisherigen Moduldaten bleiben (nur Fachprüfer, protokolliert); Projektdaten und Status bleiben."""
    projekt = hole_oder_404(db, Projekt, projekt_id)
    sperre_pruefen(db, projekt)
    if projekt.status == "freigegeben":
        raise HTTPException(status.HTTP_409_CONFLICT, "Freigegebene Projekte bleiben ohnehin unverändert.")
    modul_ablehnen(db, projekt, benutzer.id, daten.bemerkung.strip() if daten else "")
    db.commit()
    return module_abgleich(projekt_id, db)


@router.delete("/{projekt_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(nur_admin)])
def loeschen(projekt_id: int, db: Session = Depends(get_db)):
    db.delete(hole_oder_404(db, Projekt, projekt_id))
    db.commit()


@router.get("/{projekt_id}/protokoll", response_model=list[ProtokollLesen])
def protokoll(projekt_id: int, db: Session = Depends(get_db)):
    hole_oder_404(db, Projekt, projekt_id)
    eintraege = db.scalars(
        select(Protokoll).where(Protokoll.projekt_id == projekt_id)
        .options(selectinload(Protokoll.benutzer)).order_by(Protokoll.id.desc()).limit(500)
    ).all()
    return [protokoll_lesen(e) for e in eintraege]


def protokoll_lesen(e: Protokoll) -> ProtokollLesen:
    return ProtokollLesen(
        id=e.id, zeitpunkt=e.zeitpunkt, benutzer_id=e.benutzer_id,
        benutzer_name=e.benutzer.name if e.benutzer else "System", projekt_id=e.projekt_id,
        objektart=e.objektart, objekt_id=e.objekt_id, aktion=e.aktion, aenderungen=e.aenderungen,
    )
