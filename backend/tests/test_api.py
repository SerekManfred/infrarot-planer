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
    assert client.get("/api/auth/ich").json()["rollen"] == ["aussendienst"]
    client.post("/api/auth/abmelden")
    assert client.get("/api/auth/ich").status_code == 401


def test_deaktivierter_benutzer(client, db, aussendienst):
    aussendienst.aktiv = False
    db.commit()
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 401


# ── Bremse je Gerät/IP-Adresse (Festlegung 31.10.2026) ──────────────────────


def _falsch(client, email):
    return _anmeldung(client, email, "falsch-falsch-falsch")


def test_bremse_hinweis_ab_fuenf_sperre_nach_zehn(client, aussendienst):
    for _ in range(4):
        assert _falsch(client, aussendienst.email).json()["detail"] == "E-Mail oder Passwort falsch"
    assert _falsch(client, aussendienst.email).json()["detail"] == "E-Mail oder Passwort falsch. Noch 5 Versuche, dann 2 Minuten Pause."
    for _ in range(3):
        _falsch(client, aussendienst.email)
    assert _falsch(client, aussendienst.email).json()["detail"] == "E-Mail oder Passwort falsch. Noch 1 Versuch, dann 2 Minuten Pause."
    zehnter = _falsch(client, aussendienst.email)
    assert zehnter.status_code == 401 and "bitte 2 Minuten warten" in zehnter.json()["detail"]
    # gesperrt – auch mit richtigem Passwort
    antwort = _anmeldung(client, aussendienst.email, TEST_PASSWORT)
    assert antwort.status_code == 429
    assert antwort.json()["detail"] == "Zu viele Fehlversuche von diesem Gerät. Bitte in 2 Minuten erneut versuchen."


def test_fehlversuche_anderer_ip_zaehlen_nicht(client, db, aussendienst):
    """Fehlversuche von einem anderen Gerät sperren das Konto nicht – niemand kann einen Kollegen aussperren."""
    from datetime import UTC, datetime

    from app.models import Anmeldeversuch

    jetzt = datetime.now(UTC)
    for _ in range(30):
        db.add(Anmeldeversuch(zeitpunkt=jetzt, email=aussendienst.email, ip="203.0.113.9", erfolgreich=False))
    db.commit()
    # Dasselbe Konto von diesem Gerät (IP „testclient“): nicht gesperrt
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 200


def test_bremse_je_ip_gilt_fuer_alle_konten(client, fachpruefer):
    for i in range(10):
        _falsch(client, f"versuch{i}@test.invalid")
    assert _anmeldung(client, fachpruefer.email, TEST_PASSWORT).status_code == 429


def test_pause_vorbei_dann_wieder_ein_versuch(client, db, aussendienst):
    from datetime import UTC, datetime, timedelta

    from app.models import Anmeldeversuch

    vor_drei_minuten = datetime.now(UTC) - timedelta(minutes=3)
    for _ in range(10):
        db.add(Anmeldeversuch(zeitpunkt=vor_drei_minuten, email=aussendienst.email, ip="testclient", erfolgreich=False))
    db.commit()
    # Pause vorbei: ein weiterer Fehlversuch führt sofort wieder in die Pause
    assert _falsch(client, aussendienst.email).status_code == 401
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 429


def test_erfolg_setzt_zaehler_zurueck(client, aussendienst):
    for _ in range(9):
        _falsch(client, aussendienst.email)
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 200
    assert _falsch(client, aussendienst.email).json()["detail"] == "E-Mail oder Passwort falsch"


def test_alte_fehlversuche_zaehlen_nicht(client, db, aussendienst):
    from datetime import UTC, datetime, timedelta

    from app.models import Anmeldeversuch

    alt = datetime.now(UTC) - timedelta(hours=25)
    for _ in range(20):
        db.add(Anmeldeversuch(zeitpunkt=alt, email=aussendienst.email, ip="testclient", erfolgreich=False))
    db.commit()
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 200


def test_admin_sieht_und_loest_sperre(client, db, admin, aussendienst):
    for _ in range(10):
        _falsch(client, aussendienst.email)
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 429
    # Admin meldet sich von einem anderen Gerät an
    from fastapi.testclient import TestClient

    from app.main import app

    admin_geraet = TestClient(app, client=("198.51.100.7", 50000))
    anmelden(admin_geraet, admin.email)
    sperren = admin_geraet.get("/api/benutzer/anmeldesperren").json()
    assert sperren == [{
        "ip": "testclient", "fehlversuche": 10, "gesperrt": True, "gesperrt_bis": sperren[0]["gesperrt_bis"],
        "letzter_versuch": sperren[0]["letzter_versuch"], "konten": [aussendienst.email],
    }]
    assert admin_geraet.post("/api/benutzer/anmeldesperren/loesen", json={"ip": "testclient"}).status_code == 204
    assert admin_geraet.get("/api/benutzer/anmeldesperren").json() == []
    assert _anmeldung(client, aussendienst.email, TEST_PASSWORT).status_code == 200
    from sqlalchemy import select

    from app.models import Protokoll

    eintrag = db.scalars(select(Protokoll).where(Protokoll.aktion == "sperre_aufgehoben")).one()
    assert eintrag.benutzer_id == admin.id
    assert eintrag.aenderungen == {"ip": "testclient", "fehlversuche_vorher": 10, "ueber": "Benutzerverwaltung"}
    # nur Admins
    anmelden(admin_geraet, aussendienst.email)
    assert admin_geraet.get("/api/benutzer/anmeldesperren").status_code == 403
    assert admin_geraet.post("/api/benutzer/anmeldesperren/loesen", json={"ip": "testclient"}).status_code == 403


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
    neu = {"email": "neu@test.invalid", "name": "Neu", "passwort": "noch-ein-passwort", "rollen": ["aussendienst"]}
    angelegt = client.post("/api/benutzer", json=neu).json()
    assert client.post("/api/benutzer", json=neu).status_code == 409

    # Rollen kombinierbar; Reihenfolge und Doppelte werden bereinigt
    geaendert = client.patch(f"/api/benutzer/{angelegt['id']}", json={"rollen": ["fachpruefer", "admin", "admin"], "name": "Neu Name"})
    assert geaendert.json()["rollen"] == ["admin", "fachpruefer"]
    assert client.patch(f"/api/benutzer/{angelegt['id']}", json={"rollen": []}).status_code == 422
    assert client.patch(f"/api/benutzer/{angelegt['id']}", json={"rollen": ["chef"]}).status_code == 422

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
    assert client.patch(f"/api/benutzer/{admin.id}", json={"rollen": ["fachpruefer"]}).status_code == 409
    # Fachprüfer dazunehmen geht
    assert client.patch(f"/api/benutzer/{admin.id}", json={"rollen": ["admin", "fachpruefer"]}).status_code == 200
    assert client.get("/api/auth/ich").json()["rollen"] == ["admin", "fachpruefer"]


def test_letzter_admin_bleibt(client, db, admin):
    from app.models import Benutzer
    from app.sicherheit import passwort_hashen

    zweiter = Benutzer(email="admin2@test.invalid", name="Admin 2", rollen=["admin"], passwort_hash=passwort_hashen(TEST_PASSWORT))
    db.add(zweiter)
    db.commit()
    anmelden(client, admin.email)
    # Zwei aktive Admins: den anderen herabstufen geht
    assert client.patch(f"/api/benutzer/{zweiter.id}", json={"rollen": ["aussendienst"]}).status_code == 200
