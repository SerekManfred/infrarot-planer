"""Firmendaten und Logo (Paket M3, 02.11.2026). Alle Angaben sind TESTWERTE."""
import io

import pytest
from PIL import Image

import app.logo as logo
from app.models import Firma
from tests.conftest import anmelden
from tests.test_projekt import _patch, _post, projekt  # noqa: F401  (Fixture)


@pytest.fixture(autouse=True)
def logo_ordner(tmp_path, monkeypatch):
    monkeypatch.setattr(logo, "ORDNER", tmp_path / "logos")
    return tmp_path / "logos"


def _png(breite=40, hoehe=20) -> bytes:
    puffer = io.BytesIO()
    Image.new("RGB", (breite, hoehe), (31, 58, 110)).save(puffer, "PNG")
    return puffer.getvalue()


def _hoch(client, firma_id, inhalt, name="logo.png"):
    return client.post(f"/api/firmen/{firma_id}/logo", files={"datei": (name, inhalt, "application/octet-stream")})


def test_nur_admin_pflegt_alle_lesen(client, admin, fachpruefer, aussendienst):
    anmelden(client, fachpruefer.email)
    assert client.post("/api/firmen", json={"name": "TEST GmbH"}).status_code == 403
    anmelden(client, admin.email)
    a = _post(client, "/api/firmen", {"name": "TEST A GmbH", "standard": True, "ort": "TESTORT"})
    b = _post(client, "/api/firmen", {"name": "TEST B GmbH"})
    assert client.post("/api/firmen", json={"name": "TEST B GmbH"}).status_code == 409
    b = _patch(client, f"/api/firmen/{b['id']}", {"standard": True, "telefon": "0000"})
    standard = {f["name"]: f["standard"] for f in client.get("/api/firmen").json()}
    assert standard == {"TEST A GmbH": False, "TEST B GmbH": True}
    assert client.patch(f"/api/firmen/{b['id']}", json={"standard": False}).status_code == 409
    assert client.delete(f"/api/firmen/{b['id']}").status_code == 409
    assert client.delete(f"/api/firmen/{a['id']}").status_code == 204
    anmelden(client, aussendienst.email)
    assert [f["name"] for f in client.get("/api/firmen").json()] == ["TEST B GmbH"]
    assert client.patch(f"/api/firmen/{b['id']}", json={"telefon": "1"}).status_code == 403


def test_logo_png_jpg_svg_und_abgelehnte_dateien(client, db, admin, logo_ordner):
    anmelden(client, admin.email)
    f = _post(client, "/api/firmen", {"name": "TEST GmbH", "standard": True})
    r = _hoch(client, f["id"], _png(), "irgendwas.exe")  # Endung egal, Inhalt zählt
    assert r.status_code == 200 and r.json()["hat_logo"] is True
    datei = db.get(Firma, f["id"]).logo_datei
    assert datei.startswith("logo_") and datei.endswith(".png") and (logo_ordner / datei).stat().st_mode & 0o111 == 0
    antwort = client.get(f"/api/firmen/{f['id']}/logo")
    assert antwort.headers["content-type"] == "image/png" and Image.open(io.BytesIO(antwort.content)).size == (40, 20)
    # ersetzen: alte Datei wird entfernt
    jpg = io.BytesIO()
    Image.new("RGB", (30, 30), (255, 0, 0)).save(jpg, "JPEG")
    assert _hoch(client, f["id"], jpg.getvalue(), "logo.png").status_code == 200
    assert not (logo_ordner / datei).exists()
    # abgelehnt: falscher Inhalt, zu groß, SVG mit Entitäten
    assert "Nur PNG, JPG oder SVG" in _hoch(client, f["id"], b"MZ\x90\x00 kein Bild", "logo.png").json()["detail"]
    assert "größer als 2 MB" in _hoch(client, f["id"], b"\x89PNG\r\n\x1a\n" + b"0" * (2 * 1024 * 1024)).json()["detail"]
    boese = b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>'
    assert _hoch(client, f["id"], boese, "logo.svg").status_code == 422
    assert client.delete(f"/api/firmen/{f['id']}/logo").json()["hat_logo"] is False
    assert client.get(f"/api/firmen/{f['id']}/logo").status_code == 404


def test_svg_bereinigt_skripte_und_externe_verweise():
    svg = (b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10" onload="alert(1)">'
           b'<script>alert(1)</script><image xlink:href="http://example.invalid/x.png" width="5" height="5"/>'
           b'<a href="javascript:alert(1)"><rect width="10" height="10" fill="#123456"/></a></svg>')
    sauber = logo.svg_bereinigen(svg)
    assert b"script" not in sauber and b"onload" not in sauber and b"example.invalid" not in sauber and b"javascript" not in sauber
    assert b"rect" in sauber


def test_svg_wird_png(client, admin):
    pytest.importorskip("cairosvg")
    anmelden(client, admin.email)
    f = _post(client, "/api/firmen", {"name": "TEST SVG GmbH", "standard": True})
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#1f3a6e"/></svg>'
    assert _hoch(client, f["id"], svg, "logo.svg").status_code == 200
    bild = Image.open(io.BytesIO(client.get(f"/api/firmen/{f['id']}/logo").content))
    assert bild.format == "PNG" and bild.size == (1200, 600)


def test_berichtsfirma_je_projekt(client, admin, projekt):  # noqa: F811
    anmelden(client, admin.email)
    f = _post(client, "/api/firmen", {"name": "TEST GmbH", "standard": True})
    p = _patch(client, f"/api/projekte/{projekt['projekt']['id']}", {"berichtsfirma_id": f["id"]})
    assert p["berichtsfirma_id"] == f["id"]
    assert client.patch(f"/api/projekte/{projekt['projekt']['id']}", json={"berichtsfirma_id": 999}).status_code == 422
