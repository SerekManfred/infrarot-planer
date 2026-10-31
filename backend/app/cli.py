"""Verwaltungsbefehle.

  python -m app.cli admin-anlegen --email E --name N
  python -m app.cli benutzer-anlegen --email E --name N [--rollen aussendienst,fachpruefer,admin]
  python -m app.cli rollen-setzen --email E --rollen admin,fachpruefer
  python -m app.cli passwort-setzen --email E
  python -m app.cli sperre-loesen (--email E | --ip IP)
  python -m app.cli benutzer-deaktivieren --email E
  python -m app.cli email-aendern --alt ALTE@ADRESSE --neu NEUE@ADRESSE
  python -m app.cli bibliothek-importieren {bauteile,raumtypen,klimadaten} DATEI.csv
  python -m app.cli excel-importieren [--probelauf] [--umbenennen ALT=NEU ...] < DATEI.xlsx
  python -m app.cli regel-setzen --schluessel S [--wert W | --text T] --quelle Q
  python -m app.cli vorgaben-quelle-setzen --text T
  python -m app.cli vorgaben-abgleichen
  python -m app.cli vorgaben-uebernehmen --projekt NUMMER

Änderungen an Fachvorgaben gleichen danach die Projekte ab (app/vorgabenabgleich.py).

Das Passwort wird verdeckt abgefragt oder mit --passwort-stdin von der Standardeingabe gelesen.
"""
import argparse
import getpass
import sys
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import protokoll  # noqa: F401  (Änderungen über die Kommandozeile werden ebenfalls protokolliert)
from app.csv_import import FORMATE, importiere
from app.db import sitzungsfabrik
from app.anmeldebremse import freigeben, ips_mit_fehlversuchen
from app.excel_import import ImportFehler, importiere_excel
from app.vorgabenabgleich import abgleichen
from app.models import ROLLEN, Anmeldeversuch, Benutzer, Fachvorgaben, Platzierungsregel, Projekt, Protokoll
from app.schemas import ROLLEN_REIHENFOLGE
from app.sicherheit import MIN_PASSWORT_LAENGE, passwort_hashen


def _passwort(von_stdin: bool) -> str:
    if von_stdin:
        return sys.stdin.readline().rstrip("\n")
    erstes = getpass.getpass(f"Passwort (mind. {MIN_PASSWORT_LAENGE} Zeichen): ")
    if getpass.getpass("Passwort wiederholen: ") != erstes:
        sys.exit("Passwörter stimmen nicht überein.")
    return erstes


def rollen_lesen(text: str) -> list[str]:
    """„admin, fachpruefer“ → ["admin", "fachpruefer"] (feste Reihenfolge, ohne Doppelte)"""
    rollen = {r.strip() for r in text.split(",") if r.strip()}
    unbekannt = rollen - set(ROLLEN)
    if unbekannt or not rollen:
        raise ValueError(f"Rollen ungültig: {text!r} – erlaubt: {', '.join(ROLLEN)}")
    return [r for r in ROLLEN_REIHENFOLGE if r in rollen]


def rollen_setzen(db: Session, email: str, rollen: list[str]) -> None:
    """Setzt die Rollen eines Kontos; Passwort und Sitzungen bleiben. Mindestens ein aktiver Admin bleibt."""
    benutzer = db.scalars(select(Benutzer).where(func.lower(Benutzer.email) == email.strip().lower())).first()
    if benutzer is None:
        raise ValueError(f"Benutzer {email} nicht gefunden.")
    benutzer.rollen = rollen
    db.flush()
    if not any(b.hat_rolle("admin") for b in db.scalars(select(Benutzer).where(Benutzer.aktiv.is_(True)))):
        db.rollback()
        raise ValueError("Es muss mindestens ein aktiver Admin bleiben.")
    db.commit()


def benutzer_anlegen(email: str, name: str, rollen: list[str], von_stdin: bool) -> None:
    email = email.strip().lower()
    with sitzungsfabrik()() as db:
        if db.scalars(select(Benutzer).where(func.lower(Benutzer.email) == email)).first():
            sys.exit(f"Benutzer {email} existiert bereits.")
        try:
            passwort_hash = passwort_hashen(_passwort(von_stdin))
        except ValueError as fehler:
            sys.exit(str(fehler))
        db.add(Benutzer(email=email, name=name, rollen=rollen, passwort_hash=passwort_hash))
        db.commit()
    print(f"Benutzer {email} ({', '.join(rollen)}) angelegt.")


def passwort_setzen(db: Session, email: str, passwort: str) -> int:
    """Setzt ein neues Passwort, meldet alle Sitzungen ab und hebt die Anmeldebremse auf.

    Die Bremse zählt je IP-Adresse (app/anmeldebremse.py); freigegeben werden alle IP-Adressen, von denen für dieses
    Konto in den letzten 24 Stunden Fehlversuche kamen. Gibt die Zahl der freigegebenen IP-Adressen zurück.
    """
    email = email.strip().lower()
    benutzer = db.scalars(select(Benutzer).where(func.lower(Benutzer.email) == email)).first()
    if benutzer is None:
        raise ValueError(f"Benutzer {email} nicht gefunden.")
    benutzer.passwort_hash = passwort_hashen(passwort)  # ValueError bei weniger als 12 Zeichen; protokolliert
    benutzer.sitzungs_version += 1  # alle Geräte abmelden
    anzahl = freigeben(db, ips_mit_fehlversuchen(db, email), None, "Kommandozeile passwort-setzen")
    db.commit()
    return anzahl


def sperre_loesen(db: Session, email: str | None, ip: str | None) -> int:
    """Anmeldebremse aufheben: für eine IP-Adresse oder für alle IP-Adressen mit Fehlversuchen zu einem Konto."""
    ips = [ip] if ip else ips_mit_fehlversuchen(db, email or "")
    anzahl = freigeben(db, ips, None, "Kommandozeile sperre-loesen")
    db.commit()
    return anzahl


def benutzer_deaktivieren(email: str) -> None:
    with sitzungsfabrik()() as db:
        benutzer = db.scalars(select(Benutzer).where(func.lower(Benutzer.email) == email.strip().lower())).first()
        if benutzer is None:
            sys.exit(f"Benutzer {email} nicht gefunden.")
        benutzer.aktiv = False
        benutzer.sitzungs_version += 1
        db.commit()
    print(f"Benutzer {email} deaktiviert.")


def email_aendern(db: Session, alt: str, neu: str) -> None:
    """Ändert die Anmelde-E-Mail; Passwort, Rollen und Projekte bleiben unverändert."""
    alt, neu = alt.strip().lower(), neu.strip().lower()
    if "@" not in neu or len(neu) > 254:
        raise ValueError(f"Ungültige E-Mail-Adresse: {neu}")
    benutzer = db.scalars(select(Benutzer).where(func.lower(Benutzer.email) == alt)).first()
    if benutzer is None:
        raise ValueError(f"Benutzer {alt} nicht gefunden.")
    if db.scalars(select(Benutzer).where(func.lower(Benutzer.email) == neu, Benutzer.id != benutzer.id)).first():
        raise ValueError(f"E-Mail {neu} ist bereits vergeben.")
    benutzer.email = neu
    db.commit()


def bibliothek_importieren(art: str, datei: str) -> None:
    with open(datei, encoding="utf-8-sig") as f:
        text = f.read()
    with sitzungsfabrik()() as db:
        neu, aktualisiert, fehler = importiere(db, art, text)
        if not fehler and art == "raumtypen":
            abgleichen(db, None)
    if fehler:
        print("Nichts importiert. Fehler:", *fehler, sep="\n  ", file=sys.stderr)
        sys.exit(1)
    print(f"{art}: {neu} neu, {aktualisiert} aktualisiert.")


def excel_importieren(db: Session, inhalt: bytes, umbenennen: list[str], probelauf: bool) -> str:
    """Importdatei des Auftraggebers (app/excel_import.py). Probelauf: Bericht zeigen, nichts speichern."""
    paare = {}
    for eintrag in umbenennen:
        alt, _, neu = eintrag.partition("=")
        if not alt.strip() or not neu.strip():
            raise ValueError(f"--umbenennen erwartet ALT=NEU, nicht {eintrag!r}")
        paare[alt.strip()] = neu.strip()
    try:
        bericht = importiere_excel(db, inhalt, paare)
    except ImportFehler as fehler:
        db.rollback()
        raise ValueError("Nichts importiert. Fehler:\n  " + "\n  ".join(fehler.fehler)) from None
    if probelauf:
        db.rollback()
        return "PROBELAUF – nichts gespeichert\n" + bericht.text()
    db.commit()
    return bericht.text() + "\n" + abgleich_text(abgleichen(db, None))


def abgleich_text(ergebnis: dict) -> str:
    return (f"Projekte abgeglichen: {len(ergebnis['still'])} ohne Auswirkung übernommen, "
            f"{len(ergebnis['betroffen'])} warten auf den Fachprüfer")


def regel_setzen(db: Session, schluessel: str, wert: float | None, text: str | None, quelle: str) -> str:
    """Wert und Quelle einer Platzierungsregel setzen (protokolliert), danach Projekte abgleichen."""
    regel = db.get(Platzierungsregel, schluessel)
    if regel is None:
        raise ValueError(f"Platzierungsregel {schluessel} gibt es nicht.")
    if not quelle.strip():
        raise ValueError("Quelle ist Pflicht.")
    if wert is not None:
        regel.wert = wert
    if text is not None:
        regel.wert_text = text
    regel.quelle = quelle.strip()
    db.commit()
    wert_text = f"{regel.wert:g}" if regel.wert is not None else regel.wert_text
    return f"{regel.bezeichnung}: {wert_text} {regel.einheit}\n" + abgleich_text(abgleichen(db, None))


def vorgaben_quelle_setzen(db: Session, text: str) -> str:
    vorgaben = db.get(Fachvorgaben, 1)
    vorgaben.quelle = text.strip()
    db.commit()
    return "Quelle der zentralen Werte gesetzt.\n" + abgleich_text(abgleichen(db, None))


def vorgaben_uebernehmen_cli(db: Session, nummer: str) -> str:
    """Neue zentrale Vorgaben in ein Projekt übernehmen, wie der Klick des Fachprüfers (protokolliert, ohne Benutzer)."""
    from app.routers.projekte import vorgaben_uebernehmen

    projekt = db.scalars(select(Projekt).where(Projekt.nummer == nummer)).first()
    if projekt is None:
        raise ValueError(f"Projekt {nummer} nicht gefunden.")
    try:
        ergebnis = vorgaben_uebernehmen(projekt.id, db, Benutzer(id=None, name="Kommandozeile"))
    except Exception as fehler:  # HTTPException (gesperrt, freigegeben) als Meldung
        db.rollback()
        raise ValueError(getattr(fehler, "detail", str(fehler))) from None
    db.refresh(projekt)
    return f"Projekt {nummer}: Vorgaben-Stand {ergebnis.stand_am:%d.%m.%Y %H:%M}, Status {projekt.status}"



def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Verwaltung Infrarot-Planer")
    befehle = parser.add_subparsers(dest="befehl", required=True)

    for befehl in ("admin-anlegen", "benutzer-anlegen"):
        p = befehle.add_parser(befehl)
        p.add_argument("--email", required=True)
        p.add_argument("--name", required=True)
        p.add_argument("--passwort-stdin", action="store_true", help="Passwort aus der ersten Zeile von stdin lesen")
        if befehl == "benutzer-anlegen":
            p.add_argument("--rollen", default="aussendienst", help="kommagetrennt, z. B. admin,fachpruefer")

    p = befehle.add_parser("rollen-setzen")
    p.add_argument("--email", required=True)
    p.add_argument("--rollen", required=True, help="kommagetrennt, z. B. admin,fachpruefer")

    p = befehle.add_parser("passwort-setzen", help="neues Passwort setzen und Anmeldesperre des Kontos aufheben")
    p.add_argument("--email", required=True)
    p.add_argument("--passwort-stdin", action="store_true", help="Passwort aus der ersten Zeile von stdin lesen")

    p = befehle.add_parser("benutzer-deaktivieren")
    p.add_argument("--email", required=True)

    p = befehle.add_parser("email-aendern")
    p.add_argument("--alt", required=True)
    p.add_argument("--neu", required=True)

    p = befehle.add_parser("bibliothek-importieren")
    p.add_argument("art", choices=sorted(FORMATE))
    p.add_argument("datei")

    p = befehle.add_parser("excel-importieren", help="Importdatei (Raumtypen, Platzierungsregeln, Modulkatalog) von stdin")
    p.add_argument("--umbenennen", action="append", default=[], metavar="ALT=NEU",
                   help="vorhandenen Raumtyp einem Namen in der Datei zuordnen (mehrfach möglich)")
    p.add_argument("--probelauf", action="store_true", help="nur prüfen und Bericht zeigen, nichts speichern")

    p = befehle.add_parser("regel-setzen", help="Wert und Quelle einer Platzierungsregel setzen")
    p.add_argument("--schluessel", required=True)
    p.add_argument("--wert", type=float)
    p.add_argument("--text")
    p.add_argument("--quelle", required=True)
    p = befehle.add_parser("vorgaben-quelle-setzen", help="Quellentext der zentralen Werte setzen")
    p.add_argument("--text", required=True)
    befehle.add_parser("vorgaben-abgleichen", help="Projekte mit den zentralen Vorgaben abgleichen")
    p = befehle.add_parser("vorgaben-uebernehmen", help="neue zentrale Vorgaben in ein Projekt übernehmen")
    p.add_argument("--projekt", required=True, help="Projektnummer")

    p = befehle.add_parser("sperre-loesen", help="Anmeldebremse aufheben (je IP-Adresse)")
    gruppe = p.add_mutually_exclusive_group(required=True)
    gruppe.add_argument("--email", help="alle IP-Adressen mit Fehlversuchen zu diesem Konto freigeben")
    gruppe.add_argument("--ip")

    args = parser.parse_args(argv)
    if args.befehl == "admin-anlegen":
        benutzer_anlegen(args.email, args.name, ["admin"], args.passwort_stdin)
    elif args.befehl == "benutzer-anlegen":
        try:
            benutzer_anlegen(args.email, args.name, rollen_lesen(args.rollen), args.passwort_stdin)
        except ValueError as fehler:
            sys.exit(str(fehler))
    elif args.befehl == "rollen-setzen":
        with sitzungsfabrik()() as db:
            try:
                rollen = rollen_lesen(args.rollen)
                rollen_setzen(db, args.email, rollen)
            except ValueError as fehler:
                sys.exit(str(fehler))
        print(f"Rollen von {args.email.strip().lower()}: {', '.join(rollen)}")
    elif args.befehl == "passwort-setzen":
        with sitzungsfabrik()() as db:
            try:
                fehlversuche = passwort_setzen(db, args.email, _passwort(args.passwort_stdin))
            except ValueError as fehler:
                sys.exit(str(fehler))
        print(f"Passwort für {args.email.strip().lower()} gesetzt, alle Sitzungen abgemeldet, "
              f"Anmeldebremse für {fehlversuche} Gerät(e)/IP-Adresse(n) aufgehoben.")
    elif args.befehl == "sperre-loesen":
        with sitzungsfabrik()() as db:
            anzahl = sperre_loesen(db, args.email, args.ip)
        print(f"Anmeldebremse für {anzahl} Gerät(e)/IP-Adresse(n) aufgehoben.")
    elif args.befehl == "benutzer-deaktivieren":
        benutzer_deaktivieren(args.email)
    elif args.befehl == "email-aendern":
        with sitzungsfabrik()() as db:
            try:
                email_aendern(db, args.alt, args.neu)
            except ValueError as fehler:
                sys.exit(str(fehler))
        print(f"E-Mail geändert: {args.alt.strip().lower()} → {args.neu.strip().lower()}")
    elif args.befehl == "excel-importieren":
        with sitzungsfabrik()() as db:
            try:
                print(excel_importieren(db, sys.stdin.buffer.read(), args.umbenennen, args.probelauf))
            except ValueError as fehler:
                sys.exit(str(fehler))
    elif args.befehl in ("regel-setzen", "vorgaben-quelle-setzen", "vorgaben-abgleichen", "vorgaben-uebernehmen"):
        with sitzungsfabrik()() as db:
            try:
                if args.befehl == "regel-setzen":
                    print(regel_setzen(db, args.schluessel, args.wert, args.text, args.quelle))
                elif args.befehl == "vorgaben-quelle-setzen":
                    print(vorgaben_quelle_setzen(db, args.text))
                elif args.befehl == "vorgaben-abgleichen":
                    print(abgleich_text(abgleichen(db, None)))
                else:
                    print(vorgaben_uebernehmen_cli(db, args.projekt))
            except ValueError as fehler:
                sys.exit(str(fehler))
    else:
        bibliothek_importieren(args.art, args.datei)


if __name__ == "__main__":
    main()
