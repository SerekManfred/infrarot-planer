"""Verständliche deutsche Fehlermeldungen für ungültige Eingaben (statt der technischen Feldliste von Pydantic)."""

FELDER = {
    "bezeichnung": "Bezeichnung", "nummer": "Projektnummer", "kunde_name": "Kunde", "gebaeudestandard": "Gebäudestandard",
    "email": "E-Mail", "passwort": "Passwort", "neues_passwort": "neues Passwort", "altes_passwort": "bisheriges Passwort",
    "name": "Name", "rollen": "Rollen", "laenge_m": "Länge", "breite_m": "Breite", "hoehe_m": "Höhe",
    "flaeche_m2": "Fläche", "pauschale_w_m2": "Pauschale (W/m²)", "theta_int": "Raumtemperatur", "luftwechsel": "Luftwechsel",
    "hottgenroth_w": "Hottgenroth-Heizlast", "w_m2": "Pauschale (W/m²)", "wert": "Wert", "quelle": "Quelle",
    "u_wert": "U-Wert", "flaeche_brutto_m2": "Fläche", "anzahl": "Anzahl", "position": "Abstand von der Wandecke",
    "breite": "Breite", "leistung_w": "Leistung", "sperrflaechen": "Sperrflächen", "module": "Module",
    "tueren_fenster": "Türen und Fenster", "plz": "PLZ", "ort": "Ort", "strasse": "Straße", "geraet": "Gerätename",
    "status": "Status", "aktion": "Aktion", "projekt_ids": "Projektauswahl", "benutzer_id": "Benutzer",
}


def _feld(loc: tuple) -> str:
    teile = [str(t) for t in loc if t not in ("body", "query", "path")]
    for t in reversed(teile):
        if t in FELDER:
            return FELDER[t]
    return teile[-1] if teile else "Eingabe"


def _grund(fehler: dict) -> str:
    art = fehler.get("type", "")
    k = fehler.get("ctx") or {}
    def zahl(w) -> str:
        return (f"{w:g}" if isinstance(w, (int, float)) else str(w)).replace(".", ",")

    if art == "missing":
        return "fehlt"
    if art in ("greater_than_equal", "greater_than"):
        return f"muss {'mindestens' if art.endswith('equal') else 'größer als'} {zahl(k.get('ge', k.get('gt')))} sein"
    if art in ("less_than_equal", "less_than"):
        return f"darf höchstens {zahl(k.get('le', k.get('lt')))} sein"
    if art == "string_too_short":
        return "darf nicht leer sein" if k.get("min_length") in (None, 1) else f"braucht mindestens {k['min_length']} Zeichen"
    if art == "string_too_long":
        return f"darf höchstens {k.get('max_length')} Zeichen haben"
    if art in ("too_short", "too_long"):
        return "hat zu wenige Einträge" if art == "too_short" else "hat zu viele Einträge"
    if art in ("literal_error", "enum"):
        return "ist keine gültige Auswahl"
    if art.startswith(("float", "int", "decimal")):
        return "muss eine Zahl sein"
    if art.startswith("bool"):
        return "muss ja oder nein sein"
    return "ist ungültig"


def eingabefehler_text(fehler: list[dict]) -> str:
    teile = []
    for f in fehler:
        if f.get("type") == "value_error":
            # eigene Prüfungen (z. B. „Bad geeignet“ nur ab IP44) liefern bereits einen verständlichen Satz
            text = str(f.get("msg", "")).removeprefix("Value error, ")
        else:
            text = f"{_feld(tuple(f.get('loc', ())))} {_grund(f)}"
        if text not in teile:
            teile.append(text)
    return "Bitte Eingaben prüfen: " + "; ".join(teile[:5]) + ("; …" if len(teile) > 5 else "") + "."
