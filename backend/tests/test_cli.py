import pytest

from app.cli import email_aendern
from app.models import Benutzer
from app.sicherheit import passwort_pruefen
from tests.conftest import TEST_PASSWORT


def test_email_aendern_behaelt_passwort_und_rolle(db, admin):
    email_aendern(db, " Admin@Test.invalid ", "Neu@Test.invalid")
    benutzer = db.get(Benutzer, admin.id)
    assert benutzer.email == "neu@test.invalid"
    assert benutzer.rollen == ["admin"]
    assert passwort_pruefen(benutzer.passwort_hash, TEST_PASSWORT)


def test_email_aendern_unbekannt_vergeben_ungueltig(db, admin, aussendienst):
    with pytest.raises(ValueError, match="nicht gefunden"):
        email_aendern(db, "gibts@nicht.invalid", "x@test.invalid")
    with pytest.raises(ValueError, match="bereits vergeben"):
        email_aendern(db, admin.email, aussendienst.email)
    with pytest.raises(ValueError, match="Ungültige"):
        email_aendern(db, admin.email, "ohne-at-zeichen")
    assert db.get(Benutzer, admin.id).email == "admin@test.invalid"


def test_anmeldung_mit_neuer_email(client, db, admin):
    email_aendern(db, admin.email, "neu@test.invalid")
    assert client.post("/api/auth/anmelden", json={"email": "neu@test.invalid", "passwort": TEST_PASSWORT}).status_code == 200
    assert client.post("/api/auth/anmelden", json={"email": "admin@test.invalid", "passwort": TEST_PASSWORT}).status_code == 401


def test_rollen_setzen_kombiniert(db, admin):
    from app.cli import rollen_lesen, rollen_setzen

    assert rollen_lesen(" fachpruefer , admin,admin") == ["admin", "fachpruefer"]
    with pytest.raises(ValueError, match="ungültig"):
        rollen_lesen("admin,chef")
    rollen_setzen(db, "ADMIN@test.invalid", ["admin", "fachpruefer"])
    benutzer = db.get(Benutzer, admin.id)
    assert benutzer.rollen == ["admin", "fachpruefer"]
    assert passwort_pruefen(benutzer.passwort_hash, TEST_PASSWORT)


def test_rollen_setzen_letzter_admin_bleibt(db, admin):
    from app.cli import rollen_setzen

    with pytest.raises(ValueError, match="mindestens ein aktiver Admin"):
        rollen_setzen(db, admin.email, ["fachpruefer"])
    assert db.get(Benutzer, admin.id).rollen == ["admin"]
