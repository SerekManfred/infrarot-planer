"""Moduldaten in laufenden Projekten (Festlegung Auftraggeber 31.10.2026).

Platzierte Module tragen eine Kopie ihrer Katalogdaten (Stand zum Zeitpunkt der Planung, `raum.module`). Ändert sich
ein im Projekt verwendetes Modul im Katalog, gilt dieselbe Logik wie bei den Fachvorgaben (app/vorgabenabgleich.py):
- ohne Auswirkung auf Heizlast, installierte Leistung, Modulauswahl und Regelprüfung: still übernehmen (protokolliert);
- mit Auswirkung: Das Projekt wartet auf den Fachprüfer (übernehmen oder bewusst ablehnen), kein Angebot bis dahin.
Abgelehnt wird der jeweilige Katalogstand eines Moduls; ändert sich das Modul danach erneut, ist es wieder offen.
Freigegebene Projekte bleiben unverändert. Deaktivieren ändert keine Moduldaten.
"""
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BibModul, Projekt, Protokoll

FELDER = ("artikel_nr", "bezeichnung", "leistung_w", "laenge_m", "breite_m", "schutzart", "bad_geeignet")
FELD_TEXT = {
    "artikel_nr": "Artikel-Nr.", "bezeichnung": "Bezeichnung", "leistung_w": "Leistung (W)", "laenge_m": "Länge (m)",
    "breite_m": "Breite (m)", "schutzart": "Schutzart", "bad_geeignet": "Bad geeignet",
}
GRUND_STILL = "keine Auswirkung auf Heizlast, installierte Leistung und Regelprüfung"


def katalogdaten(m: BibModul) -> dict:
    """Katalogdaten so, wie sie ein platziertes Modul speichert (Länge = längere Seite, in m)."""
    return {
        "artikel_nr": m.artikel_nr, "bezeichnung": m.bezeichnung, "leistung_w": m.leistung_w,
        "laenge_m": round(max(m.laenge_mm, m.breite_mm) / 1000, 6), "breite_m": round(min(m.laenge_mm, m.breite_mm) / 1000, 6),
        "schutzart": m.schutzart, "bad_geeignet": m.bad_geeignet,
    }


def katalog(db: Session) -> dict[int, dict]:
    return {m.id: katalogdaten(m) for m in db.scalars(select(BibModul))}


def _platzierte(projekt: Projekt):
    for objekt in projekt.objekte:
        for geschoss in objekt.geschosse:
            for raum in geschoss.raeume:
                yield raum, raum.module or []


def verwendungen(db: Session, modul_id: int) -> int:
    """In wie vielen Projekten ein Modul platziert ist."""
    return sum(
        1 for p in db.scalars(select(Projekt))
        if any(m.get("modul_id") == modul_id for _r, liste in _platzierte(p) for m in liste)
    )


def _gleich(a, b) -> bool:
    if isinstance(a, float) or isinstance(b, float):
        return a is not None and b is not None and abs(float(a) - float(b)) < 1e-9
    return a == b


def unterschiede(projekt: Projekt, kat: dict[int, dict]) -> list[dict]:
    """Abweichungen zwischen den im Projekt gespeicherten Moduldaten und dem Katalog (je Modul und Feld einmal)."""
    gesehen: set[tuple] = set()
    liste: list[dict] = []
    for _raum, module in _platzierte(projekt):
        for m in module:
            neu = kat.get(m.get("modul_id"))
            if neu is None:
                continue
            for feld in FELDER:
                if _gleich(m.get(feld), neu[feld]):
                    continue
                schluessel = (m["modul_id"], feld, m.get(feld))
                if schluessel in gesehen:
                    continue
                gesehen.add(schluessel)
                liste.append({
                    "modul_id": m["modul_id"], "artikel_nr": neu["artikel_nr"], "feld": feld,
                    "bezeichnung": f"{neu['artikel_nr']}: {FELD_TEXT[feld]}", "alt": m.get(feld), "neu": neu[feld],
                })
    return liste


def offene_unterschiede(projekt: Projekt, kat: dict[int, dict]) -> list[dict]:
    """Unterschiede, über die noch nicht entschieden ist (ohne bewusst abgelehnte Katalogstände)."""
    if projekt.status == "freigegeben":
        return []
    abgelehnt = projekt.module_abgelehnt or {}
    return [u for u in unterschiede(projekt, kat) if abgelehnt.get(str(u["modul_id"])) != kat[u["modul_id"]]]


def mit_katalog(kat: dict[int, dict], nur: set[int] | None = None):
    """Funktion für die Auswertung: ersetzt die Moduldaten durch den Katalogstand (Lage, Drehung, ID bleiben)."""
    def ersetzen(module: list) -> list:
        return [
            {**m, **kat[m["modul_id"]]} if m.get("modul_id") in kat and (nur is None or m["modul_id"] in nur) else m
            for m in module
        ]
    return ersetzen


def auswirkung(db: Session, projekt: Projekt, kat: dict[int, dict], nur: set[int] | None = None) -> dict | None:
    from app.vorgabenabgleich import vergleich  # Kreisimport vermeiden
    from app.vorgabenstand import projekt_stand

    stand = projekt_stand(db, projekt)
    return vergleich(db, projekt, stand, stand, mit_katalog(kat, nur))


def _protokoll(db: Session, projekt: Projekt, benutzer_id: int | None, aktion: str, aenderungen: dict) -> None:
    db.add(Protokoll(
        zeitpunkt=datetime.now(UTC), benutzer_id=benutzer_id, projekt_id=projekt.id, objektart="Projekt",
        objekt_id=projekt.id, aktion=aktion, aenderungen=aenderungen,
    ))


def uebernehmen(db: Session, projekt: Projekt, benutzer_id: int | None, kat: dict[int, dict] | None = None,
                automatisch: bool = False) -> list[dict]:
    """Aktuelle Katalogdaten in die platzierten Module übernehmen (offene Unterschiede); committet nicht."""
    kat = kat if kat is not None else katalog(db)
    offen = offene_unterschiede(projekt, kat)
    if not offen:
        return []
    ids = {u["modul_id"] for u in offen}
    folge = auswirkung(db, projekt, kat, ids)
    ersetzen = mit_katalog(kat, ids)
    for raum, module in _platzierte(projekt):
        if any(m.get("modul_id") in ids for m in module):
            raum.module = ersetzen(module)  # Änderung am Raum wird zusätzlich je Feld protokolliert
    abgelehnt = dict(projekt.module_abgelehnt or {})
    for i in ids:
        abgelehnt.pop(str(i), None)
    projekt.module_abgelehnt = abgelehnt or None
    _protokoll(db, projekt, benutzer_id, "module_uebernommen", {
        "unterschiede": offen,
        **({"automatisch": True, "grund": GRUND_STILL} if automatisch else {}),
        **({"installiert_w": [folge["installiert_alt_w"], folge["installiert_neu_w"]],
            "neue_verstoesse": folge["neue_verstoesse"]} if folge else {}),
    })
    return offen


def ablehnen(db: Session, projekt: Projekt, benutzer_id: int | None, bemerkung: str = "",
             kat: dict[int, dict] | None = None, automatisch: bool = False) -> list[dict]:
    """Bewusst bei den bisherigen Moduldaten bleiben (je Modul der aktuelle Katalogstand); committet nicht."""
    kat = kat if kat is not None else katalog(db)
    offen = offene_unterschiede(projekt, kat)
    if not offen:
        return []
    abgelehnt = dict(projekt.module_abgelehnt or {})
    for u in offen:
        abgelehnt[str(u["modul_id"])] = kat[u["modul_id"]]
    projekt.module_abgelehnt = abgelehnt
    _protokoll(db, projekt, benutzer_id, "module_abgelehnt", {
        "unterschiede": offen, **({"bemerkung": bemerkung} if bemerkung else {}),
        **({"automatisch": True} if automatisch else {}),
    })
    return offen


def abgleichen(db: Session, benutzer_id: int | None) -> dict:
    """Nach einer Katalogänderung alle laufenden Projekte abgleichen: ohne Auswirkung still übernehmen; committet."""
    kat = katalog(db)
    still: list[int] = []
    betroffen: list[int] = []
    for projekt in db.scalars(select(Projekt).where(Projekt.status != "freigegeben").order_by(Projekt.id)):
        offen = offene_unterschiede(projekt, kat)
        if not offen:
            continue
        if auswirkung(db, projekt, kat, {u["modul_id"] for u in offen}) is not None:
            betroffen.append(projekt.id)
            continue
        uebernehmen(db, projekt, benutzer_id, kat, automatisch=True)
        still.append(projekt.id)
    db.commit()
    return {"still": still, "betroffen": betroffen}


def betroffene(db: Session) -> list[dict]:
    """Sammelansicht: Projekte, die auf die Entscheidung über geänderte Moduldaten warten."""
    from app.vorgabenabgleich import projekt_kurz  # Kreisimport vermeiden

    kat = katalog(db)
    ergebnis = []
    for projekt in db.scalars(select(Projekt).where(Projekt.status != "freigegeben").order_by(Projekt.id)):
        offen = offene_unterschiede(projekt, kat)
        if not offen:
            continue
        folge = auswirkung(db, projekt, kat, {u["modul_id"] for u in offen}) or {
            "summe_alt_w": 0.0, "summe_neu_w": 0.0, "raeume": [], "neue_verstoesse": 0,
        }
        ergebnis.append({**projekt_kurz(projekt, folge), "unterschiede": len(offen), "art": "module"})
    return ergebnis
