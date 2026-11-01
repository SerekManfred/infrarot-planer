"""Datenbanksicherung aus der Anwendung heraus, z. B. vor einem Katalog-Import (Festlegung 02.11.2026).

pg_dump (Version 16, passend zum Datenbankserver) schreibt ins Uploads-Volume unter sicherungen/; dieses Volume nimmt
auch die tägliche Datensicherung mit (betrieb/backup.sh). Aufbewahrt werden die 20 jüngsten Sicherungen.
Mit einer anderen Datenbank als PostgreSQL (Tests mit SQLite) wird nicht gesichert.
"""
import os
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.engine import make_url

from app.config import einstellungen

ZIEL = Path("/app/uploads/sicherungen")
AUFBEWAHREN = 20


class SicherungFehler(Exception):
    pass


def datenbank_sichern(anlass: str) -> str | None:
    """Erstellt eine vollständige Sicherung (pg_dump, Format custom). Gibt den Dateinamen zurück, None ohne PostgreSQL."""
    url = make_url(einstellungen().datenbank_url)
    if not url.drivername.startswith("postgresql"):
        return None
    ZIEL.mkdir(parents=True, exist_ok=True)
    datei = ZIEL / f"infrarot_db_{datetime.now(UTC):%Y%m%d_%H%M%S}_{anlass}.dump"
    umgebung = {**os.environ, "PGPASSWORD": url.password or ""}  # Passwort nicht auf der Befehlszeile
    befehl = [
        "pg_dump", "-Fc", "-f", str(datei), "-h", url.host or "localhost", "-p", str(url.port or 5432),
        "-U", url.username or "", "-d", url.database or "",
    ]
    try:
        subprocess.run(befehl, env=umgebung, check=True, capture_output=True, timeout=180)
    except (OSError, subprocess.SubprocessError) as fehler:
        datei.unlink(missing_ok=True)
        raise SicherungFehler(f"Datenbanksicherung fehlgeschlagen: {fehler}") from None
    for alt in sorted(ZIEL.glob("infrarot_db_*.dump"))[:-AUFBEWAHREN]:
        alt.unlink(missing_ok=True)
    return datei.name
