"""Verwaltungsbefehle.

  python -m app.cli admin-anlegen --email E --name N
  python -m app.cli benutzer-anlegen --email E --name N [--rollen aussendienst,fachpruefer,admin]
  python -m app.cli rollen-setzen --email E --rollen admin,fachpruefer
  python -m app.cli benutzer-deaktivieren --email E
  python -m app.cli email-aendern --alt ALTE@ADRESSE --neu NEUE@ADRESSE
  python -m app.cli bibliothek-importieren {bauteile,raumtypen,klimadaten} DATEI.csv

Das Passwort wird verdeckt abgefragt oder mit --passwort-stdin von der Standardeingabe gelesen.
"""
import argparse
import getpass
import sys

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import protokoll  # noqa: F401  (Änderungen über die Kommandozeile werden ebenfalls protokolliert)
from app.csv_import import FORMATE, importiere
from app.db import sitzungsfabrik
from app.models import ROLLEN, Benutzer
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
    if fehler:
        print("Nichts importiert. Fehler:", *fehler, sep="\n  ", file=sys.stderr)
        sys.exit(1)
    print(f"{art}: {neu} neu, {aktualisiert} aktualisiert.")


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

    p = befehle.add_parser("benutzer-deaktivieren")
    p.add_argument("--email", required=True)

    p = befehle.add_parser("email-aendern")
    p.add_argument("--alt", required=True)
    p.add_argument("--neu", required=True)

    p = befehle.add_parser("bibliothek-importieren")
    p.add_argument("art", choices=sorted(FORMATE))
    p.add_argument("datei")

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
    elif args.befehl == "benutzer-deaktivieren":
        benutzer_deaktivieren(args.email)
    elif args.befehl == "email-aendern":
        with sitzungsfabrik()() as db:
            try:
                email_aendern(db, args.alt, args.neu)
            except ValueError as fehler:
                sys.exit(str(fehler))
        print(f"E-Mail geändert: {args.alt.strip().lower()} → {args.neu.strip().lower()}")
    else:
        bibliothek_importieren(args.art, args.datei)


if __name__ == "__main__":
    main()
