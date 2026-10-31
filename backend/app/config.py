"""Konfiguration ausschließlich über Umgebungsvariablen (Präfix INFRAROT_)."""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Einstellungen(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="INFRAROT_")

    datenbank_url: str
    jwt_geheimnis: str = Field(min_length=32)
    sitzung_stunden: int = 12
    # Nur über HTTPS senden; für den lokalen Zugriff über 127.0.0.1 per .env abschaltbar
    cookie_secure: bool = True
    node_pfad: str = "node"
    rechenkern_cli: str = "/opt/rechenkern/cli.cjs"
    rechenkern_timeout_s: float = 30.0
    # Bremse gegen Anmeldeversuche
    # Anmeldebremse je IP-Adresse (app/anmeldebremse.py, Festlegung 31.10.2026)
    anmeldung_max_fehlversuche: int = 10
    anmeldung_pause_minuten: int = 2
    anmeldung_hinweis_ab: int = 5


@lru_cache
def einstellungen() -> Einstellungen:
    return Einstellungen()
