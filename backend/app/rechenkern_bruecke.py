"""Aufruf des TypeScript-Rechenkerns (rechenkern/dist/cli.cjs) über Node."""
import json
import subprocess

from app.config import einstellungen


class RechenkernFehler(Exception):
    def __init__(self, pfad: str, meldung: str):
        super().__init__(f"{pfad}: {meldung}" if pfad else meldung)
        self.pfad = pfad
        self.meldung = meldung


def berechne_heizlast(eingabe: dict) -> dict:
    """Gibt das Ergebnis zurück oder wirft RechenkernFehler (fachlich) bzw. RuntimeError (technisch)."""
    e = einstellungen()
    try:
        lauf = subprocess.run(
            [e.node_pfad, e.rechenkern_cli],
            input=json.dumps(eingabe),
            capture_output=True,
            text=True,
            timeout=e.rechenkern_timeout_s,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as fehler:
        raise RuntimeError(f"Rechenkern nicht ausführbar: {fehler}") from fehler
    try:
        antwort = json.loads(lauf.stdout)
    except json.JSONDecodeError as fehler:
        raise RuntimeError(f"Rechenkern lieferte keine gültige Antwort: {lauf.stderr.strip()[:500]}") from fehler
    if not antwort.get("ok"):
        f = antwort.get("fehler", {})
        raise RechenkernFehler(f.get("pfad", ""), f.get("meldung", "unbekannter Fehler"))
    return antwort["ergebnis"]
