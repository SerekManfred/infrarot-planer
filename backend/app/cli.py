"""Verwaltungsbefehle.

  python -m app.cli admin-anlegen --email E --name N
  python -m app.cli benutzer-anlegen --email E --name N [--rolle berater|admin]
  python -m app.cli benutzer-deaktivieren --email E
  python -m app.cli bibliothek-importieren {bauteile,raumtypen,klimadaten} DATEI.csv

Das Passwort wird verdeckt abgefragt oder mit --passwort-stdin von der Standardeingabe gelesen.
"""
import argparse
import getpass
import sys

from sqlalchemy import func, select

from app.csv_import import FORMATE, importiere
from app.db import sitzungsfabrik
from app.models import Benutzer
from app.sicherheit import MIN_PASSWORT_LAENGE, passwort_hashen


def _passwort(von_stdin: bool) -> str:
    if von_stdin:
        return sys.stdin.readline().rstrip("\n")
    erstes = getpass.getpass(f"Passwort (mind. {MIN_PASSWORT_LAENGE} Zeichen): ")
    if getpass.getpass("Passwort wiederholen: ") != erstes:
        sys.exit("Passwörter stimmen nicht überein.")
    return erstes


def benutzer_anlegen(email: str, name: str, rolle: str, von_stdin: bool) -> None:
    email = email.strip().lower()
    with sitzungsfabrik()() as db:
        if db.scalars(select(Benutzer).where(func.lower(Benutzer.email) == email)).first():
            sys.exit(f"Benutzer {email} existiert bereits.")
        try:
            passwort_hash = passwort_hashen(_passwort(von_stdin))
        except ValueError as fehler:
            sys.exit(str(fehler))
        db.add(Benutzer(email=email, name=name, rolle=rolle, passwort_hash=passwort_hash))
        db.commit()
    print(f"Benutzer {email} ({rolle}) angelegt.")


def benutzer_deaktivieren(email: str) -> None:
    with sitzungsfabrik()() as db:
        benutzer = db.scalars(select(Benutzer).where(func.lower(Benutzer.email) == email.strip().lower())).first()
        if benutzer is None:
            sys.exit(f"Benutzer {email} nicht gefunden.")
        benutzer.aktiv = False
        db.commit()
    print(f"Benutzer {email} deaktiviert.")


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
            p.add_argument("--rolle", choices=["berater", "admin"], default="berater")

    p = befehle.add_parser("benutzer-deaktivieren")
    p.add_argument("--email", required=True)

    p = befehle.add_parser("bibliothek-importieren")
    p.add_argument("art", choices=sorted(FORMATE))
    p.add_argument("datei")

    args = parser.parse_args(argv)
    if args.befehl == "admin-anlegen":
        benutzer_anlegen(args.email, args.name, "admin", args.passwort_stdin)
    elif args.befehl == "benutzer-anlegen":
        benutzer_anlegen(args.email, args.name, args.rolle, args.passwort_stdin)
    elif args.befehl == "benutzer-deaktivieren":
        benutzer_deaktivieren(args.email)
    else:
        bibliothek_importieren(args.art, args.datei)


if __name__ == "__main__":
    main()
