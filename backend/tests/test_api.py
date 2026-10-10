"""Anmeldung, Bremse, Passwort, Rollen und Benutzerverwaltung."""
from tests.conftest import TEST_PASSWORT, anmelden


def _anmeldung(client, email, passwort):
    return client.post("/api/auth/anmelden", json={"email": email, "passwort": passwort})


def test_ohne_anmeldung_gesperrt(client):
    assert client.get("/api/projekte").status_code == 401
    assert client.get("/api/gesundheit").json() == {"status": "ok"}


def test_anmeldung_falsches_passwort_und_unbekannt(client, aussendienst):
    assert _anmeldung(client, aussendienst.email, "falsch-falsch-falsch").status_code == 401
    assert _anmeldung(client, "gibts@nicht.invalid", "egal-egal-egal").status_code == 401


def test_anmelden_ich_abmelden(client, aussendienst):
    anmelden(client, "AUSSENDIENST@test.invalid")  # Groß-/Kleinschreibung egal
    assert client.cookies.get("infrarot_sitzung")
    assert client.get("/api/auth/ich").json()["rolle"] == "aussendienst"
    client.post("/api/auth/abmelden")
    assert client.get("/api/auth/ich").status_code == 401


def test_deaktivierter_benutzer(client, db, aussendienst):
    aussendienst.aktiv = False
    db.commit()
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 401


# ── Bremse ──────────────────────────────────────────────────────────────────


def test_bremse_nach_fuenf_fehlversuchen(client, aussendienst, fachpruefer):
    for _ in range(5):
        assert _anmeldung(client, aussendienst.email, "falsch-falsch-falsch").status_code == 401
    # Auch das richtige Passwort wird jetzt abgewiesen
    antwort = _anmeldung(client, aussendienst.email, TEST_PASSWORT)
    assert antwort.status_code == 429
    assert "15 Minuten" in antwort.json()["detail"]
    # Andere Konten sind nicht betroffen
    assert _anmeldung(client, fachpruefer.email, TEST_PASSWORT).status_code == 200


def test_erfolg_setzt_zaehler_zurueck(client, aussendienst):
    for _ in range(4):
        _anmeldung(client, aussendienst.email, "falsch-falsch-falsch")
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 200
    for _ in range(4):
        _anmeldung(client, aussendienst.email, "falsch-falsch-falsch")
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 200


def test_bremse_je_ip(client, db, aussendienst):
    from app.config import einstellungen

    for i in range(einstellungen().anmeldung_max_fehlversuche_ip):
        _anmeldung(client, f"versuch{i}@test.invalid", "falsch-falsch-falsch")
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 429


def test_alte_fehlversuche_zaehlen_nicht(client, db, aussendienst):
    from datetime import UTC, datetime, timedelta

    from app.models import Anmeldeversuch

    alt = datetime.now(UTC) - timedelta(minutes=16)
    for _ in range(10):
        db.add(Anmeldeversuch(zeitpunkt=alt, email=aussendienst.email, ip="testclient", erfolgreich=False))
    db.commit()
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 200


# ── Passwort ────────────────────────────────────────────────────────────────


def test_passwort_aendern(client, aussendienst):
    from fastapi.testclient import TestClient

    from app.main import app

    anmelden(client, aussendienst.email)
    zweites_geraet = TestClient(app)
    anmelden(zweites_geraet, aussendienst.email)

    falsch = client.post("/api/auth/passwort", json={"altes_passwort": "nicht-richtig-123", "neues_passwort": "x" * 12})
    assert falsch.status_code == 400
    kurz = client.post("/api/auth/passwort", json={"altes_passwort": TEST_PASSWORT, "neues_passwort": "kurz"})
    assert kurz.status_code == 422

    neu = "ein-neues-passwort-456"
    assert client.post("/api/auth/passwort", json={"altes_passwort": TEST_PASSWORT, "neues_passwort": neu}).status_code == 204
    # Dieses Gerät bleibt angemeldet (neues Cookie), andere Sitzungen werden ungültig
    assert client.get("/api/auth/ich").status_code == 200
    assert zweites_geraet.get("/api/auth/ich").status_code == 401
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 401
    assert _anmeldung(client, aussendienst.email, neu).status_code == 200


# ── Rollen ──────────────────────────────────────────────────────────────────


def test_rechte_aussendienst(client, aussendienst):
    anmelden(client, aussendienst.email)
    assert client.get("/api/benutzer").status_code == 403
    assert client.put("/api/fachvorgaben/werte", json={}).status_code == 403
    assert client.post("/api/fachvorgaben/raumtypen", json={"bezeichnung": "X"}).status_code == 403
    csv = b"plz;ort;theta_e;quelle\n00000;TESTORT;-10;TESTWERT\n"
    assert client.post("/api/bibliotheken/klimadaten/import", files={"datei": ("k.csv", csv)}).status_code == 403
    assert client.get("/api/fachvorgaben").status_code == 200


def test_rechte_fachpruefer(client, fachpruefer):
    anmelden(client, fachpruefer.email)
    assert client.get("/api/benutzer").status_code == 403
    assert client.post("/api/fachvorgaben/raumtypen", json={"bezeichnung": "TESTRAUM"}).status_code == 201
    csv = b"plz;ort;theta_e;quelle\n00000;TESTORT;-10;TESTWERT\n"
    assert client.post("/api/bibliotheken/klimadaten/import", files={"datei": ("k.csv", csv)}).status_code == 200


# ── Benutzerverwaltung ──────────────────────────────────────────────────────


def test_admin_verwaltet_benutzer(client, admin):
    anmelden(client, admin.email)
    neu = {"email": "neu@test.invalid", "name": "Neu", "passwort": "noch-ein-passwort", "rolle": "aussendienst"}
    angelegt = client.post("/api/benutzer", json=neu).json()
    assert client.post("/api/benutzer", json=neu).status_code == 409

    geaendert = client.patch(f"/api/benutzer/{angelegt['id']}", json={"rolle": "fachpruefer", "name": "Neu Name"})
    assert geaendert.json()["rolle"] == "fachpruefer"

    from fastapi.testclient import TestClient

    from app.main import app

    neuer = TestClient(app)
    anmelden(neuer, "neu@test.invalid", "noch-ein-passwort")
    assert client.patch(f"/api/benutzer/{angelegt['id']}", json={"aktiv": False}).json()["aktiv"] is False
    assert neuer.get("/api/auth/ich").status_code == 401  # Sitzung sofort beendet

    assert client.patch(f"/api/benutzer/{angelegt['id']}", json={"aktiv": True}).status_code == 200
    assert client.post(f"/api/benutzer/{angelegt['id']}/passwort", json={"neues_passwort": "vom-admin-gesetzt"}).status_code == 204
    assert _anmeldung(neuer, "neu@test.invalid", "vom-admin-gesetzt").status_code == 200


def test_admin_kann_sich_nicht_aussperren(client, admin):
    anmelden(client, admin.email)
    assert client.patch(f"/api/benutzer/{admin.id}", json={"aktiv": False}).status_code == 409
    assert client.patch(f"/api/benutzer/{admin.id}", json={"rolle": "fachpruefer"}).status_code == 409
    assert client.get("/api/auth/ich").json()["rolle"] == "admin"


def test_letzter_admin_bleibt(client, db, admin):
    from app.models import Benutzer
    from app.sicherheit import passwort_hashen

    zweiter = Benutzer(email="admin2@test.invalid", name="Admin 2", rolle="admin", passwort_hash=passwort_hashen(TEST_PASSWORT))
    db.add(zweiter)
    db.commit()
    anmelden(client, admin.email)
    # Zwei aktive Admins: den anderen herabstufen geht
    assert client.patch(f"/api/benutzer/{zweiter.id}", json={"rolle": "aussendienst"}).status_code == 200
