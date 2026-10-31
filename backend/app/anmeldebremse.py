"""Anmeldebremse je Gerät/IP-Adresse (Festlegung Auftraggeber 31.10.2026).

- Gezählt werden Fehlversuche je IP-Adresse – nicht je Konto, damit niemand einen Kollegen durch falsche Versuche
  aussperren kann. Es zählen nur Fehlversuche seit der letzten erfolgreichen Anmeldung bzw. Freigabe von dieser
  IP-Adresse und höchstens aus den letzten 24 Stunden.
- Ab dem 5. Fehlversuch: Hinweis „Noch x Versuche“.
- Nach 10 Fehlversuchen 2 Minuten Pause; danach je weiterem Fehlversuch erneut 2 Minuten (Raten bleibt gebremst).
- Freigabe durch Admin (Benutzerverwaltung) oder Kommandozeile: ein Eintrag „erfolgreich“ für die IP-Adresse setzt
  den Zähler zurück, ohne die Historie zu löschen; die Freigabe wird protokolliert.

Hinweis: Mehrere Geräte hinter einem gemeinsamen Internetanschluss (z. B. Büro) teilen sich eine IP-Adresse.
"""
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import einstellungen
from app.models import Anmeldeversuch, Protokoll

ZAEHLFENSTER = timedelta(hours=24)
# Kennung der Freigabe-Einträge (statt einer E-Mail-Adresse)
FREIGABE = "freigabe"


@dataclass
class Zustand:
    fehlversuche: int
    gesperrt_bis: datetime | None
    letzter_versuch: datetime | None


def _utc(z: datetime) -> datetime:
    return z if z.tzinfo else z.replace(tzinfo=UTC)


def zustand(db: Session, ip: str, jetzt: datetime | None = None) -> Zustand:
    e = einstellungen()
    jetzt = jetzt or datetime.now(UTC)
    seit = jetzt - ZAEHLFENSTER
    letzter_erfolg = db.scalar(
        select(func.max(Anmeldeversuch.zeitpunkt)).where(Anmeldeversuch.ip == ip, Anmeldeversuch.erfolgreich.is_(True))
    )
    if letzter_erfolg is not None:
        seit = max(seit, _utc(letzter_erfolg))
    fehl = db.scalars(
        select(Anmeldeversuch.zeitpunkt)
        .where(Anmeldeversuch.ip == ip, Anmeldeversuch.erfolgreich.is_(False), Anmeldeversuch.zeitpunkt > seit)
        .order_by(Anmeldeversuch.zeitpunkt)
    ).all()
    letzter = _utc(fehl[-1]) if fehl else None
    gesperrt_bis = None
    if len(fehl) >= e.anmeldung_max_fehlversuche and letzter is not None:
        ende = letzter + timedelta(minutes=e.anmeldung_pause_minuten)
        gesperrt_bis = ende if ende > jetzt else None
    return Zustand(len(fehl), gesperrt_bis, letzter)


def pause_text(bis: datetime, jetzt: datetime) -> str:
    minuten = max(1, -(-int((bis - jetzt).total_seconds()) // 60))  # aufrunden
    return "1 Minute" if minuten == 1 else f"{minuten} Minuten"


def meldung_nach_fehlversuch(anzahl: int) -> str:
    """Text für einen Fehlversuch; anzahl = Fehlversuche dieser IP-Adresse einschließlich des aktuellen."""
    e = einstellungen()
    if anzahl >= e.anmeldung_max_fehlversuche:
        return f"E-Mail oder Passwort falsch. Zu viele Fehlversuche – bitte {e.anmeldung_pause_minuten} Minuten warten."
    if anzahl >= e.anmeldung_hinweis_ab:
        rest = e.anmeldung_max_fehlversuche - anzahl
        return f"E-Mail oder Passwort falsch. Noch {rest} {'Versuch' if rest == 1 else 'Versuche'}, dann {e.anmeldung_pause_minuten} Minuten Pause."
    return "E-Mail oder Passwort falsch"


def auffaellige(db: Session) -> list[dict]:
    """IP-Adressen ab dem Hinweis-Schwellwert, mit Sperrstatus und den versuchten Konten (für die Benutzerverwaltung)."""
    e = einstellungen()
    jetzt = datetime.now(UTC)
    ips = db.scalars(
        select(Anmeldeversuch.ip).where(Anmeldeversuch.erfolgreich.is_(False), Anmeldeversuch.zeitpunkt > jetzt - ZAEHLFENSTER).distinct()
    ).all()
    liste = []
    for ip in ips:
        z = zustand(db, ip, jetzt)
        if z.fehlversuche < e.anmeldung_hinweis_ab:
            continue
        konten = db.scalars(
            select(Anmeldeversuch.email).where(
                Anmeldeversuch.ip == ip, Anmeldeversuch.erfolgreich.is_(False), Anmeldeversuch.zeitpunkt > jetzt - ZAEHLFENSTER
            ).distinct()
        ).all()
        liste.append({
            "ip": ip, "fehlversuche": z.fehlversuche, "gesperrt": z.gesperrt_bis is not None,
            "gesperrt_bis": z.gesperrt_bis, "letzter_versuch": z.letzter_versuch, "konten": sorted(konten),
        })
    return sorted(liste, key=lambda x: (not x["gesperrt"], -x["fehlversuche"]))


def ips_mit_fehlversuchen(db: Session, email: str) -> list[str]:
    """IP-Adressen, von denen für dieses Konto in den letzten 24 Stunden Fehlversuche kamen."""
    seit = datetime.now(UTC) - ZAEHLFENSTER
    return list(db.scalars(
        select(Anmeldeversuch.ip).where(
            Anmeldeversuch.email == email.strip().lower(), Anmeldeversuch.erfolgreich.is_(False), Anmeldeversuch.zeitpunkt > seit
        ).distinct()
    ))


def freigeben(db: Session, ips: list[str], benutzer_id: int | None, ueber: str) -> int:
    """Hebt die Bremse für die IP-Adressen auf (Freigabe-Eintrag + Protokoll); committet nicht. Gibt die Anzahl zurück."""
    jetzt = datetime.now(UTC)
    for ip in ips:
        vorher = zustand(db, ip, jetzt).fehlversuche
        db.add(Anmeldeversuch(zeitpunkt=jetzt, email=FREIGABE, ip=ip, erfolgreich=True))
        db.add(Protokoll(
            zeitpunkt=jetzt, benutzer_id=benutzer_id, projekt_id=None, objektart="Anmeldesperre", objekt_id=None,
            aktion="sperre_aufgehoben", aenderungen={"ip": ip, "fehlversuche_vorher": vorher, "ueber": ueber},
        ))
    return len(ips)
