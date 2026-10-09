"""Stellt aus den Projektdaten die Eingabe für den Rechenkern zusammen.

Fehlende Kennwerte werden nicht ergänzt oder geschätzt, sondern als Liste gemeldet.
"""
from app.models import Bauteilflaeche, Objekt, Oeffnung, Raum


class EingabeUnvollstaendig(Exception):
    def __init__(self, maengel: list[str]):
        super().__init__("; ".join(maengel))
        self.maengel = maengel


def _u_wert(element: Bauteilflaeche | Oeffnung) -> float | None:
    if element.u_wert is not None:
        return element.u_wert
    return element.bauteil.u_wert if element.bauteil else None


def _raum_eingabe(raum: Raum, ort: str, maengel: list[str]) -> dict:
    raumtyp = raum.raumtyp
    theta_int = raum.theta_int if raum.theta_int is not None else (raumtyp.theta_int if raumtyp else None)
    n = raum.luftwechsel if raum.luftwechsel is not None else (raumtyp.luftwechsel if raumtyp else None)
    if raum.volumen_m3 is not None:
        volumen = raum.volumen_m3
    elif raum.flaeche_m2 is not None and raum.hoehe_m is not None:
        volumen = raum.flaeche_m2 * raum.hoehe_m
    else:
        volumen = None
    if theta_int is None:
        maengel.append(f"{ort}: keine Innentemperatur (Raumtyp oder eigener Wert)")
    if n is None:
        maengel.append(f"{ort}: keine Luftwechselrate (Raumtyp oder eigener Wert)")
    if volumen is None:
        maengel.append(f"{ort}: kein Volumen (Fläche und Höhe oder eigener Wert)")

    flaechen = []
    for fl in raum.flaechen:
        fl_ort = f"{ort} / Fläche „{fl.bezeichnung or fl.id}“"
        u = _u_wert(fl)
        if u is None:
            maengel.append(f"{fl_ort}: kein U-Wert (Bauteil oder eigener Wert)")
        oeffnungen = []
        for oe in fl.oeffnungen:
            u_oe = _u_wert(oe)
            if u_oe is None:
                maengel.append(f"{fl_ort} / Öffnung „{oe.bezeichnung or oe.id}“: kein U-Wert")
            oeffnungen.append(
                {"bezeichnung": oe.bezeichnung or f"Öffnung {oe.id}", "flaeche_m2": oe.flaeche_m2,
                 "anzahl": oe.anzahl, "u_wert_w_m2k": u_oe}
            )
        flaechen.append(
            {
                "bezeichnung": fl.bezeichnung or f"Fläche {fl.id}",
                "flaeche_brutto_m2": fl.flaeche_brutto_m2,
                "u_wert_w_m2k": u,
                "angrenzung": fl.angrenzung,
                "theta_angrenzend_c": fl.theta_angrenzend,
                "f_korrektur": fl.f_korrektur,
                "delta_u_wb_w_m2k": fl.delta_u_wb,
                "oeffnungen": oeffnungen,
            }
        )
    return {
        "id": str(raum.id),
        "bezeichnung": raum.bezeichnung,
        "theta_int_c": theta_int,
        "luftwechsel_1_h": n,
        "volumen_m3": volumen,
        "flaechen": flaechen,
    }


def heizlast_eingabe(objekt: Objekt) -> dict:
    maengel: list[str] = []
    if objekt.klimadaten is None:
        maengel.append("Objekt: keine Klimadaten (Norm-Außentemperatur) zugeordnet")
    if objekt.delta_u_wb is None:
        maengel.append("Objekt: kein Wärmebrückenzuschlag ΔU_WB angegeben")
    raeume = [
        _raum_eingabe(raum, f"{geschoss.bezeichnung} / {raum.bezeichnung}", maengel)
        for geschoss in objekt.geschosse
        for raum in geschoss.raeume
    ]
    if not raeume:
        maengel.append("Objekt: keine Räume erfasst")
    if maengel:
        raise EingabeUnvollstaendig(maengel)
    return {
        "theta_e_c": objekt.klimadaten.theta_e,
        "delta_u_wb_w_m2k": objekt.delta_u_wb,
        "raeume": raeume,
        # Nur zur Nachvollziehbarkeit, vom Rechenkern nicht ausgewertet
        "herkunft": {
            "klimadaten": {"id": objekt.klimadaten.id, "plz": objekt.klimadaten.plz,
                           "ort": objekt.klimadaten.ort, "quelle": objekt.klimadaten.quelle},
        },
    }
