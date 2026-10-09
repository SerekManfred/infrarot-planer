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
from app.models import Benutzer
from app.sicherheit import passwort_hashen

TEST_PASSWORT = "test-passwort-123"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda verbindung, _: verbindung.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    fabrik = sessionmaker(bind=engine, expire_on_commit=False)
    with fabrik() as sitzung:
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

    app.dependency_overrides[get_db] = db_je_anfrage
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _benutzer(db, email: str, rolle: str) -> Benutzer:
    b = Benutzer(email=email, name=email.split("@")[0], rolle=rolle, passwort_hash=passwort_hashen(TEST_PASSWORT))
    db.add(b)
    db.commit()
    return b


@pytest.fixture
def admin(db):
    return _benutzer(db, "admin@test.invalid", "admin")


@pytest.fixture
def berater(db):
    return _benutzer(db, "berater@test.invalid", "berater")


def anmelden(client: TestClient, email: str) -> None:
    antwort = client.post("/api/auth/anmelden", json={"email": email, "passwort": TEST_PASSWORT})
    assert antwort.status_code == 200, antwort.text
