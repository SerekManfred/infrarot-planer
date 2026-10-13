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


def test_passwort_setzen_hebt_sperre_auf_und_protokolliert(client, db, admin):
    from sqlalchemy import select

    from app.cli import passwort_setzen
    from app.models import Protokoll

    for _ in range(5):
        assert client.post("/api/auth/anmelden", json={"email": admin.email, "passwort": "falsch-falsch-falsch"}).status_code == 401
    # Konto gesperrt – auch mit richtigem Passwort
    assert client.post("/api/auth/anmelden", json={"email": admin.email, "passwort": TEST_PASSWORT}).status_code == 429

    version = admin.sitzungs_version
    assert passwort_setzen(db, " ADMIN@test.invalid ", "ganz-neues-passwort") == 5
    benutzer = db.get(Benutzer, admin.id)
    assert passwort_pruefen(benutzer.passwort_hash, "ganz-neues-passwort")
    assert benutzer.sitzungs_version == version + 1
    assert benutzer.rollen == ["admin"]

    # Sperre aufgehoben, neues Passwort gilt, altes nicht
    assert client.post("/api/auth/anmelden", json={"email": admin.email, "passwort": TEST_PASSWORT}).status_code == 401
    assert client.post("/api/auth/anmelden", json={"email": admin.email, "passwort": "ganz-neues-passwort"}).status_code == 200

    eintraege = db.scalars(select(Protokoll).where(Protokoll.objektart == "Benutzer", Protokoll.objekt_id == admin.id)).all()
    assert any(e.aenderungen.get("passwort") == "geändert" for e in eintraege)
    sperre = next(e for e in eintraege if e.aktion == "sperre_aufgehoben")
    assert sperre.aenderungen["fehlversuche_vorher"] == 5
    assert "passwort_hash" not in str([e.aenderungen for e in eintraege])


def test_passwort_setzen_fehler(db, admin):
    from app.cli import passwort_setzen

    with pytest.raises(ValueError, match="nicht gefunden"):
        passwort_setzen(db, "gibts@nicht.invalid", "lang-genug-passwort")
    with pytest.raises(ValueError, match="mindestens 12"):
        passwort_setzen(db, admin.email, "zu-kurz")
    assert passwort_pruefen(db.get(Benutzer, admin.id).passwort_hash, TEST_PASSWORT)
