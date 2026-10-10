import pytest

from app.sicherheit import passwort_hashen, passwort_pruefen, token_erzeugen, token_lesen


def test_passwort_hash_ist_argon2_und_pruefbar():
    h = passwort_hashen("ein-langes-passwort")
    assert h.startswith("$argon2id$")
    assert passwort_pruefen(h, "ein-langes-passwort")
    assert not passwort_pruefen(h, "falsches-passwort")


def test_kurzes_passwort_abgelehnt():
    with pytest.raises(ValueError):
        passwort_hashen("kurz")


def test_kaputter_hash_ist_kein_treffer():
    assert not passwort_pruefen("kein-hash", "egal")


def test_token_hin_und_zurueck():
    assert token_lesen(token_erzeugen(42, 3)) == (42, 3)
    assert token_lesen("manipuliert") is None
