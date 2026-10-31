"""Offline-Betrieb: Auschecken/Einchecken mit Sperre, Schnappschuss der Vorgaben, vollständiger Projektstand.

Alle Zahlen sind TESTWERTE (Fantasiewerte).
"""
import pytest

from tests.conftest import _benutzer, anmelden
from tests.test_projekt import _post, _raum, projekt  # noqa: F401  (Fixture)


def _auschecken(client, pid, geraet="Tablet 1", sperre=None):
    kopf = {"X-Sperre": sperre} if sperre else {}
    return client.post(f"/api/projekte/{pid}/auschecken", json={"geraet": geraet}, headers=kopf)


@pytest.fixture
def ausgecheckt(client, projekt):  # noqa: F811
    antwort = _auschecken(client, projekt["projekt"]["id"])
    assert antwort.status_code == 200, antwort.text
    return {**projekt, "sperre": antwort.json()["sperre"]}


def test_auschecken_zeigt_wer_und_seit_wann(client, ausgecheckt, aussendienst):
    p = client.get(f"/api/projekte/{ausgecheckt['projekt']['id']}").json()
    assert p["ausgecheckt_von_id"] == aussendienst.id
    assert p["ausgecheckt_von_name"] == aussendienst.name
    assert p["ausgecheckt_geraet"] == "Tablet 1"
    assert p["ausgecheckt_am"] is not None
    assert "sperre_hash" not in p
    # in der Projektliste ebenso
    assert client.get("/api/projekte").json()[0]["ausgecheckt_geraet"] == "Tablet 1"


def test_nur_das_geraet_mit_token_darf_aendern(client, db, ausgecheckt, fachpruefer):
    gid = ausgecheckt["geschoss"]["id"]
    kopf = {"X-Sperre": ausgecheckt["sperre"]}
    # dasselbe Konto ohne Token (z. B. zweites Gerät): gesperrt
    antwort = client.post(f"/api/geschosse/{gid}/raeume", json={"bezeichnung": "R"})
    assert antwort.status_code == 423
    assert "Tablet 1" in antwort.json()["detail"]
    # falsches Token: gesperrt
    assert client.post(f"/api/geschosse/{gid}/raeume", json={"bezeichnung": "R"}, headers={"X-Sperre": "falsch"}).status_code == 423
    # das Gerät selbst
    raum = client.post(f"/api/geschosse/{gid}/raeume", json={"bezeichnung": "R"}, headers=kopf)
    assert raum.status_code == 201
    # anderer Benutzer mit gestohlenem Token: gesperrt
    anmelden(client, fachpruefer.email)
    assert client.patch(f"/api/raeume/{raum.json()['id']}", json={"hoehe_m": 3}, headers=kopf).status_code == 423
    # Fachprüfer kann den Status nicht ändern, solange ausgecheckt
    assert client.post(f"/api/projekte/{ausgecheckt['projekt']['id']}/status", json={"status": "geprueft"}).status_code == 423
    # ein anderes Gerät kann nicht auschecken
    assert _auschecken(client, ausgecheckt["projekt"]["id"], "Tablet 2").status_code == 423


def test_erneut_auschecken_behaelt_token(client, ausgecheckt):
    pid = ausgecheckt["projekt"]["id"]
    antwort = _auschecken(client, pid, sperre=ausgecheckt["sperre"])
    assert antwort.status_code == 200
    assert antwort.json()["sperre"] == ausgecheckt["sperre"]


def test_einchecken_durch_geraet(client, ausgecheckt, fachpruefer):
    pid = ausgecheckt["projekt"]["id"]
    assert client.post(f"/api/projekte/{pid}/einchecken").status_code == 423  # ohne Token
    antwort = client.post(f"/api/projekte/{pid}/einchecken", headers={"X-Sperre": ausgecheckt["sperre"]})
    assert antwort.status_code == 200
    assert antwort.json()["ausgecheckt_am"] is None
    # danach wieder frei für alle
    anmelden(client, fachpruefer.email)
    assert client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"}).status_code == 200


def test_admin_loest_sperre_und_geraet_merkt_es(client, db, ausgecheckt, admin, aussendienst):
    pid = ausgecheckt["projekt"]["id"]
    anmelden(client, admin.email)
    assert client.post(f"/api/projekte/{pid}/einchecken").json()["ausgecheckt_am"] is None
    # Protokoll zeigt das Lösen der Sperre mit Namen
    eintraege = client.get(f"/api/projekte/{pid}/protokoll").json()
    assert any(e["benutzer_name"] == admin.name and "ausgecheckt_geraet" in e["aenderungen"] for e in eintraege)
    assert all("sperre_hash" not in e["aenderungen"] for e in eintraege)
    # Das Gerät überträgt danach nichts mehr mit seinem alten Token
    anmelden(client, aussendienst.email)
    antwort = client.post(
        f"/api/geschosse/{ausgecheckt['geschoss']['id']}/raeume", json={"bezeichnung": "R"},
        headers={"X-Sperre": ausgecheckt["sperre"]},
    )
    assert antwort.status_code == 409
    assert "aufgehoben" in antwort.json()["detail"]


def test_einchecken_durch_andere_nicht_admins_verboten(client, db, ausgecheckt, fachpruefer):
    # anderer Außendienst sieht das Projekt gar nicht (31.10.2026), ein Fachprüfer sieht es, darf aber nicht einchecken
    zweiter = _benutzer(db, "zweiter@test.invalid", "aussendienst")
    anmelden(client, zweiter.email)
    assert client.post(f"/api/projekte/{ausgecheckt['projekt']['id']}/einchecken").status_code == 404
    anmelden(client, fachpruefer.email)
    assert client.post(f"/api/projekte/{ausgecheckt['projekt']['id']}/einchecken").status_code == 423


def test_freigegebene_projekte_nicht_auschecken(client, db, projekt, fachpruefer):  # noqa: F811
    pid = projekt["projekt"]["id"]
    anmelden(client, fachpruefer.email)
    client.post(f"/api/projekte/{pid}/status", json={"status": "geprueft"})
    client.post(f"/api/projekte/{pid}/status", json={"status": "freigegeben"})
    assert _auschecken(client, pid).status_code == 409


def test_offline_vorgaben_schnappschuss(client, projekt):  # noqa: F811
    v = client.get("/api/offline/vorgaben").json()
    assert v["fachvorgaben"]["werte"]["rueckfall_neubau_w_m2"] == 45
    assert v["bauteile"] == [] and v["klimadaten"] == []
    assert v["stand"]


def test_offline_projektpaket_vollstaendig(client, projekt):  # noqa: F811
    raum = _raum(client, projekt)
    flaeche = _post(client, f"/api/raeume/{raum['id']}/flaechen", {"flaeche_brutto_m2": 10, "u_wert": 0.3})
    _post(client, f"/api/flaechen/{flaeche['id']}/oeffnungen", {"flaeche_m2": 2, "u_wert": 1.1})
    paket = client.get(f"/api/offline/projekte/{projekt['projekt']['id']}").json()
    g = paket["objekte"][0]["geschosse"][0]
    assert g["bezeichnung"] == "EG"
    assert g["raeume"][0]["flaeche_m2"] == 20
    assert g["raeume"][0]["flaechen"][0]["oeffnungen"][0]["u_wert"] == 1.1
    assert client.get("/api/offline/projekte/999").status_code == 404
