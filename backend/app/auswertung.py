"""Auswertung eines Objekts (Gebäudes) über alle Heizlastquellen.

Das Backend löst je Raum die Fachvorgaben auf – mit Herkunft jedes Werts – und lässt den Rechenkern rechnen.
Fehlende Werte werden nie geschätzt, sondern als Hinweis „Vorgabe fehlt“ bzw. „Eingabe fehlt“ gemeldet.

Herkunft eines Werts: "raum" | "projekt" | "vorgabe" | "rueckfall" | "klimadaten" | "fehlt"
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Bauteilflaeche, Fachvorgaben, HeizlastPauschale, Objekt, Oeffnung, Raum
from app.rechenkern_bruecke import rechenkern_aufrufen
from app.schemas import GEBAEUDESTANDARD_TEXT

HINWEIS_SONSTIGER_BESTAND = "Infrarot als alleiniges Heizsystem wird für diesen Gebäudestandard nicht empfohlen."


def _wert(wert: float | None, herkunft: str) -> dict:
    return {"wert": wert, "herkunft": herkunft if wert is not None else "fehlt"}


def _zuerst(*kandidaten: tuple[float | None, str]) -> dict:
    """Erster vorhandener Wert mit seiner Herkunft, sonst „fehlt“."""
    for wert, herkunft in kandidaten:
        if wert is not None:
            return _wert(wert, herkunft)
    return _wert(None, "fehlt")


def fachvorgaben_laden(db: Session) -> Fachvorgaben:
    return db.get(Fachvorgaben, 1) or Fachvorgaben(id=1)


def _u_wert(element: Bauteilflaeche | Oeffnung) -> float | None:
    if element.u_wert is not None:
        return element.u_wert
    return element.bauteil.u_wert if element.bauteil else None


def _gegenprobe_eingabe(raum: Raum, werte: dict, objekt_werte: dict) -> tuple[dict | None, list[str]]:
    """Rechenkern-Eingabe für Quelle C oder (None, Mängel)."""
    maengel: list[str] = []
    if objekt_werte["theta_e"]["wert"] is None:
        maengel.append("Vorgabe fehlt: Norm-Außentemperatur (Klimadaten des Gebäudes zuordnen)")
    if objekt_werte["delta_u_wb"]["wert"] is None:
        maengel.append("Vorgabe fehlt: Wärmebrückenzuschlag ΔU_WB")
    if werte["theta_int"]["wert"] is None:
        maengel.append("Vorgabe fehlt: Norm-Innentemperatur des Raumtyps")
    if werte["luftwechsel"]["wert"] is None:
        maengel.append("Vorgabe fehlt: Luftwechsel des Raumtyps")
    if raum.volumen_m3 is not None:
        volumen = raum.volumen_m3
    elif raum.flaeche_m2 is not None and raum.hoehe_m is not None:
        volumen = raum.flaeche_m2 * raum.hoehe_m
    else:
        volumen = None
        maengel.append("Eingabe fehlt: Raumvolumen (Fläche und Höhe)")

    flaechen = []
    for fl in raum.flaechen:
        ort = f"Fläche „{fl.bezeichnung or fl.id}“"
        u = _u_wert(fl)
        if u is None:
            maengel.append(f"{ort}: Eingabe fehlt: U-Wert (Bauteil wählen oder eingeben)")
        f = fl.f_korrektur
        if f is None and fl.angrenzender_raumtyp is not None:
            f = fl.angrenzender_raumtyp.reduktionsfaktor
            if f is None:
                maengel.append(f"{ort}: Vorgabe fehlt: Reduktionsfaktor für Raumtyp „{fl.angrenzender_raumtyp.bezeichnung}“")
        elif f is None and fl.angrenzung == "erdreich":
            maengel.append(f"{ort}: Eingabe fehlt: Faktor f (angrenzenden Raumtyp wählen oder f eingeben)")
        elif f is None and fl.angrenzung in ("beheizt", "unbeheizt") and fl.theta_angrenzend is None:
            maengel.append(f"{ort}: Eingabe fehlt: angrenzender Raumtyp, Nachbartemperatur oder Faktor f")
        oeffnungen = []
        for oe in fl.oeffnungen:
            u_oe = _u_wert(oe)
            if u_oe is None:
                maengel.append(f"{ort} / Öffnung „{oe.bezeichnung or oe.id}“: Eingabe fehlt: U-Wert")
            oeffnungen.append({
                "bezeichnung": oe.bezeichnung or f"Öffnung {oe.id}", "flaeche_m2": oe.flaeche_m2,
                "anzahl": oe.anzahl, "u_wert_w_m2k": u_oe,
            })
        flaechen.append({
            "bezeichnung": fl.bezeichnung or f"Fläche {fl.id}",
            "flaeche_brutto_m2": fl.flaeche_brutto_m2,
            "u_wert_w_m2k": u,
            "angrenzung": fl.angrenzung,
            "theta_angrenzend_c": fl.theta_angrenzend,
            "f_korrektur": f,
            "delta_u_wb_w_m2k": fl.delta_u_wb,
            "oeffnungen": oeffnungen,
        })
    if maengel:
        return None, maengel
    return {
        "id": str(raum.id), "bezeichnung": raum.bezeichnung,
        "theta_int_c": werte["theta_int"]["wert"], "luftwechsel_1_h": werte["luftwechsel"]["wert"],
        "volumen_m3": volumen, "flaechen": flaechen,
    }, []


def objekt_auswerten(db: Session, objekt: Objekt) -> tuple[dict, dict]:
    """Gibt (Rechenkern-Eingabe, Auswertung) zurück."""
    v = fachvorgaben_laden(db)
    gs = objekt.gebaeudestandard
    tabelle = {(p.raumtyp_id, p.gebaeudestandard): p.w_m2 for p in db.scalars(select(HeizlastPauschale))}
    rueckfall = getattr(v, f"rueckfall_{gs}_w_m2")
    abweichungen = objekt.pauschale_abweichungen or {}

    objekt_werte = {
        "rueckfall_w_m2": _wert(rueckfall, "vorgabe"),
        "hoehenzuschlag_grenzhoehe_m": _zuerst(
            (objekt.hoehenzuschlag_grenzhoehe_m, "projekt"), (v.hoehenzuschlag_grenzhoehe_m, "vorgabe")),
        "hoehenzuschlag_prozent_je_m": _zuerst(
            (objekt.hoehenzuschlag_prozent_je_m, "projekt"), (v.hoehenzuschlag_prozent_je_m, "vorgabe")),
        "delta_u_wb": _zuerst((objekt.delta_u_wb, "projekt"), (v.delta_u_wb, "vorgabe")),
        "theta_e": _wert(objekt.klimadaten.theta_e if objekt.klimadaten else None, "klimadaten"),
    }
    grenzhoehe = objekt_werte["hoehenzuschlag_grenzhoehe_m"]["wert"]
    prozent = objekt_werte["hoehenzuschlag_prozent_je_m"]["wert"]
    objekt_hinweise = [HINWEIS_SONSTIGER_BESTAND] if gs == "sonstiger_bestand" else []

    raeume_info: list[dict] = []
    raeume_eingabe: list[dict] = []
    for geschoss in objekt.geschosse:
        for raum in geschoss.raeume:
            raumtyp = raum.raumtyp
            hinweise: list[str] = []
            werte = {
                "pauschale_w_m2": _zuerst(
                    (raum.pauschale_w_m2, "raum"),
                    (abweichungen.get(str(raum.raumtyp_id)) if raumtyp else None, "projekt"),
                    (tabelle.get((raum.raumtyp_id, gs)) if raumtyp else None, "vorgabe"),
                    (rueckfall, "rueckfall"),
                ),
                "theta_int": _zuerst((raum.theta_int, "raum"), (raumtyp.theta_int if raumtyp else None, "vorgabe")),
                "luftwechsel": _zuerst(
                    (raum.luftwechsel, "raum"), (raumtyp.luftwechsel if raumtyp else None, "vorgabe")),
            }

            # Quelle A
            pauschal = None
            q = werte["pauschale_w_m2"]["wert"]
            if raum.flaeche_m2 is None:
                hinweise.append("Eingabe fehlt: Fläche (Länge × Breite)")
            elif q is None:
                hinweise.append(
                    f"Vorgabe fehlt: Pauschale W/m² für „{raumtyp.bezeichnung if raumtyp else 'ohne Raumtyp'}“ "
                    f"/ {GEBAEUDESTANDARD_TEXT[gs]}"
                )
            else:
                pauschal = {"flaeche_m2": raum.flaeche_m2, "pauschale_w_m2": q, "hoehe_m": raum.hoehe_m}
                ueber_grenze = grenzhoehe is not None and raum.hoehe_m is not None and raum.hoehe_m > grenzhoehe
                if ueber_grenze and prozent is not None:
                    pauschal["hoehenzuschlag"] = {"grenzhoehe_m": grenzhoehe, "prozent_je_m": prozent}
                elif ueber_grenze:
                    hinweise.append(
                        f"Vorgabe fehlt: Höhenzuschlag (% je m) – Raum höher als {grenzhoehe:.2f} m, ohne Zuschlag gerechnet"
                    )
                elif raum.hoehe_m is None and prozent is not None:
                    hinweise.append("Eingabe fehlt: Raumhöhe – Höhenzuschlag nicht geprüft")

            # Quelle B
            if raum.heizlastquelle == "B" and raum.hottgenroth_w is None:
                hinweise.append("Eingabe fehlt: Raumheizlast aus Hottgenroth")

            # Quelle C (Gegenprobe), nur wenn Bauteile erfasst oder C gewählt ist
            berechnung = None
            if raum.flaechen or raum.heizlastquelle == "C":
                berechnung, maengel = _gegenprobe_eingabe(raum, werte, objekt_werte)
                hinweise.extend(f"Gegenprobe C: {m}" for m in maengel)

            raeume_eingabe.append({
                "id": str(raum.id), "bezeichnung": raum.bezeichnung, "quelle": raum.heizlastquelle,
                "pauschal": pauschal, "hottgenroth_w": raum.hottgenroth_w, "berechnung": berechnung,
            })
            raeume_info.append({
                "raum_id": raum.id, "geschoss_id": geschoss.id, "geschoss": geschoss.bezeichnung,
                "bezeichnung": raum.bezeichnung, "raumtyp_id": raum.raumtyp_id,
                "raumtyp": raumtyp.bezeichnung if raumtyp else None,
                "laenge_m": raum.laenge_m, "breite_m": raum.breite_m, "flaeche_m2": raum.flaeche_m2,
                "hoehe_m": raum.hoehe_m, "quelle": raum.heizlastquelle, "werte": werte, "hinweise": hinweise,
            })

    eingabe = {
        "art": "auswertung",
        "theta_e_c": objekt_werte["theta_e"]["wert"],
        "delta_u_wb_w_m2k": objekt_werte["delta_u_wb"]["wert"],
        "raeume": raeume_eingabe,
    }
    ergebnis = rechenkern_aufrufen(eingabe)
    for info, raum_ergebnis in zip(raeume_info, ergebnis["raeume"], strict=True):
        info["hinweise"].extend(raum_ergebnis.pop("fehler"))
        raum_ergebnis.pop("id")
        raum_ergebnis.pop("bezeichnung")
        raum_ergebnis.pop("quelle")
        info.update(raum_ergebnis)

    auswertung = {
        "rechenkern_version": ergebnis["rechenkern_version"],
        "objekt": {
            "id": objekt.id, "bezeichnung": objekt.bezeichnung, "gebaeudestandard": gs,
            "gebaeudestandard_text": GEBAEUDESTANDARD_TEXT[gs],
        },
        "hinweise": objekt_hinweise,
        "vorgaben": objekt_werte,
        "raeume": raeume_info,
        "summe": ergebnis["summe"],
    }
    return eingabe, auswertung
