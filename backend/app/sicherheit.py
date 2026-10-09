"""Passwort-Hashing (Argon2id) und Sitzungs-Token (JWT im HttpOnly-Cookie)."""
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.config import einstellungen

COOKIE_NAME = "infrarot_sitzung"
MIN_PASSWORT_LAENGE = 12

_hasher = PasswordHasher()


def passwort_hashen(passwort: str) -> str:
    if len(passwort) < MIN_PASSWORT_LAENGE:
        raise ValueError(f"Passwort muss mindestens {MIN_PASSWORT_LAENGE} Zeichen haben")
    return _hasher.hash(passwort)


def passwort_pruefen(passwort_hash: str, passwort: str) -> bool:
    try:
        return _hasher.verify(passwort_hash, passwort)
    except (VerificationError, InvalidHashError):
        return False


# Wird bei unbekannter E-Mail geprüft, damit die Antwortzeit nicht verrät, ob es das Konto gibt
BLINDER_HASH = _hasher.hash("blindwert-ohne-bedeutung")


def token_erzeugen(benutzer_id: int) -> str:
    jetzt = datetime.now(UTC)
    nutzlast = {"sub": str(benutzer_id), "iat": jetzt, "exp": jetzt + timedelta(hours=einstellungen().sitzung_stunden)}
    return jwt.encode(nutzlast, einstellungen().jwt_geheimnis, algorithm="HS256")


def token_lesen(token: str) -> int | None:
    try:
        nutzlast = jwt.decode(token, einstellungen().jwt_geheimnis, algorithms=["HS256"])
        return int(nutzlast["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
