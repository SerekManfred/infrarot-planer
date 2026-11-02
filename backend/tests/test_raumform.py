"""Räume aus Rechtecken (Paket M2, 02.11.2026). Alle Werte sind TESTWERTE."""
from tests.conftest import anmelden
from tests.test_projekt import _auswertung, _patch, _raum, projekt  # noqa: F401  (Fixture)

L_TEIL = {"op": "sub", "wand": "oben", "versatz": 3, "laenge": 3, "tiefe": 2}


def test_rechteck_bleibt_rechteck_und_basis_folgt_laenge_breite(client, projekt, aussendienst):  # noqa: F811
    anmelden(client, aussendienst.email)
    raum = _raum(client, projekt, laenge_m=6, breite_m=4)
    assert raum["geometrie"] == {"basis": {"w": 6, "h": 4}, "teile": []} and raum["flaeche_m2"] == 24
    r = _patch(client, f"/api/raeume/{raum['id']}", {"geometrie": {"basis": {"w": 6, "h": 4}, "teile": [L_TEIL]}, "flaeche_m2": 18})
    assert r["geometrie"]["teile"] == [L_TEIL] and r["flaeche_m2"] == 18
    # Schnellerfassung ändert die Länge: Hauptrechteck folgt, Teile bleiben
    r = _patch(client, f"/api/raeume/{raum['id']}", {"laenge_m": 7, "flaeche_m2": 22})
    assert r["geometrie"] == {"basis": {"w": 7, "h": 4}, "teile": [L_TEIL]}
    a = _auswertung(client, projekt)["raeume"][0]
    # Rechenkern: 7 × 4 − 3 × 2; der Ausschnitt (x = 3 … 6) reicht nicht mehr bis zur Ecke → Kerbe, Umfang 22 + 2 × 2
    assert a["flaeche_m2"] == 22 and a["umfang_m"] == 26
    assert a["phi_massgeblich_w"] == 22 * 45  # Rückfallwert Neubau 45 W/m² (Testdatenbank) auf die Gesamtfläche


def test_ungueltige_teile_und_negative_koordinaten(client, projekt, aussendienst):  # noqa: F811
    anmelden(client, aussendienst.email)
    raum = _raum(client, projekt, laenge_m=4, breite_m=3)
    falsch = {**L_TEIL, "wand": "decke"}
    assert client.patch(f"/api/raeume/{raum['id']}", json={"geometrie": {"basis": {"w": 4, "h": 3}, "teile": [falsch]}}).status_code == 422
    erker = {"op": "add", "wand": "oben", "versatz": 1, "laenge": 2, "tiefe": 0.8}
    leuchte = {"id": "l1", "objekt": "leuchte", "x": 2, "y": -0.4}
    r = _patch(client, f"/api/raeume/{raum['id']}", {"geometrie": {"basis": {"w": 4, "h": 3}, "teile": [erker]}, "sperrflaechen": [leuchte]})
    assert r["sperrflaechen"][0]["y"] == -0.4


def test_tuer_an_wandsegment_mit_hoehe_und_bruestung(client, projekt, aussendienst):  # noqa: F811
    anmelden(client, aussendienst.email)
    raum = _raum(client, projekt, laenge_m=6, breite_m=4)
    tuer = {"id": "t", "art": "tuer", "wand": "oben", "linie": 2, "position": 4, "breite": 0.9, "hoehe": 2.01, "aufschlag": "innen", "band": "links"}
    fenster = {"id": "f", "art": "fenster", "wand": "links", "position": 1, "breite": 1.2, "hoehe": 1.35, "bruestung": 0.9}
    r = _patch(client, f"/api/raeume/{raum['id']}", {"geometrie": {"basis": {"w": 6, "h": 4}, "teile": [L_TEIL]}, "flaeche_m2": 18,
                                                     "tueren_fenster": [tuer, fenster]})
    assert r["tueren_fenster"][0]["linie"] == 2 and r["tueren_fenster"][1]["bruestung"] == 0.9
    assert client.patch(f"/api/raeume/{raum['id']}", json={"tueren_fenster": [{**fenster, "bruestung": 4}]}).status_code == 422
