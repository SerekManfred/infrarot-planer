"""Testumgebung: SQLite im Speicher statt PostgreSQL, eigene Sitzung je Test."""
import os

os.environ.setdefault("INFRAROT_DATENBANK_URL", "sqlite://")
os.environ.setdefault("INFRAROT_JWT_GEHEIMNIS", "nur-fuer-tests-" + "x" * 32)
os.environ.setdefault("INFRAROT_COOKIE_SECURE", "false")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import Benutzer, Fachvorgaben, Platzierungsregel
from app.platzierungsregeln import REGELN
from app.sicherheit import passwort_hashen

TEST_PASSWORT = "test-passwort-123"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda verbindung, _: verbindung.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    fabrik = sessionmaker(bind=engine, expire_on_commit=False)
    with fabrik() as sitzung:
        # Wie nach der Migration: genau ein Vorgaben-Datensatz, hier mit TESTWERTEN
        sitzung.add(Fachvorgaben(
            id=1, rueckfall_neubau_w_m2=45, rueckfall_effizienzhaus_sanierung_w_m2=75,
            hoehe_hinweis_m=2.9, delta_u_wb=0.05, quelle="TESTWERT",
        ))
        # Wie nach der Migration: alle Platzierungsregeln ohne Wert („Vorgabe fehlt“)
        sitzung.add_all(
            Platzierungsregel(schluessel=r.schluessel, bezeichnung=r.bezeichnung, einheit=r.einheit, reihenfolge=i)
            for i, r in enumerate(REGELN)
        )
        sitzung.commit()
        yield sitzung
    engine.dispose()


@pytest.fixture
def client(db):
    def db_je_anfrage():
        # Wie im Betrieb: nach einem Fehler wird die Transaktion verworfen
        try:
            yield db
        except Exception:
            db.rollback()
            raise
        finally:
            # Wie im Betrieb (neue Sitzung je Anfrage): nichts Geladenes in die nächste Anfrage mitnehmen
            db.expire_all()

    app.dependency_overrides[get_db] = db_je_anfrage
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _benutzer(db, email: str, rolle: str) -> Benutzer:
    b = Benutzer(email=email, name=email.split("@")[0], rollen=[rolle], passwort_hash=passwort_hashen(TEST_PASSWORT))
    db.add(b)
    db.commit()
    return b


@pytest.fixture
def admin(db):
    return _benutzer(db, "admin@test.invalid", "admin")


@pytest.fixture
def aussendienst(db):
    return _benutzer(db, "aussendienst@test.invalid", "aussendienst")


@pytest.fixture
def fachpruefer(db):
    return _benutzer(db, "fachpruefer@test.invalid", "fachpruefer")


def anmelden(client: TestClient, email: str, passwort: str = TEST_PASSWORT) -> None:
    client.cookies.clear()
    antwort = client.post("/api/auth/anmelden", json={"email": email, "passwort": passwort})
    assert antwort.status_code == 200, antwort.text
