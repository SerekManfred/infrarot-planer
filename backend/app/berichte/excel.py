"""Bestellliste (Paket M4b, ohne Preise) und Kalkulation intern (Paket M4c) als Excel.

Gemeinsam: Logo oben links (Bild in A1; die Kopfzeilen 1–3 werden auf jeder Druckseite wiederholt, damit das Logo
auch im Druck oben steht – openpyxl kann keine Bilder in die Excel-Druckkopfzeile setzen), Projekt in der
Druckkopfzeile, Firmendaten in der Druckfußzeile, Querformat, eine Seite breit. Gelbe Zellen mit blauer Schrift =
Eingabe. Mengen kommen per Formel aus der Blattstückliste; die Kalkulation rechnet ausschließlich mit Formeln.
"""
import io
from datetime import datetime

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XlBild
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from PIL import Image as PilImage

from app.berichte.daten import BerichtDaten, datum, firmenzeilen, stueckliste
from app.logo import LogoFehler, pfad as logo_pfad

GELB = PatternFill("solid", fgColor="FFF2B3")
KOPF = PatternFill("solid", fgColor="1F3A6E")
SUMME = PatternFill("solid", fgColor="E8EEF8")
WARN = PatternFill("solid", fgColor="FDECEA")
EINGABE = Font(color="1F4FD1", bold=True)
FETT = Font(bold=True)
WEISS = Font(bold=True, color="FFFFFF")
LINIE = Border(bottom=Side(style="thin", color="D5DBE5"))
EURO = '#,##0.00 "€"'
PROZENT = "0.0 %"
ERSTE_ZEILE = 5  # Zeilen 1–3: Logo und Titel, 4: Spaltenköpfe


def _projekttext(d: BerichtDaten) -> str:
    return f"Projekt {d.projekt.nummer}" + (f" · {d.projekt.kunde_name}" if d.projekt.kunde_name.strip() else "")


def _kopf(blatt, d: BerichtDaten, titel: str, spalten: list[tuple[str, int]]) -> None:
    """Logo/Firmenname in A1, Titel, Spaltenköpfe in Zeile 4; Druckeinstellungen."""
    blatt.row_dimensions[1].height = 45
    bild = None
    if d.firma and d.firma.logo_datei:
        try:
            p = logo_pfad(d.firma.logo_datei)
            if p.exists():
                with PilImage.open(p) as b:
                    w, h = b.size
                bild = XlBild(str(p))
                bild.height = 57  # ≈ 15 mm
                bild.width = int(57 * w / h)
                blatt.add_image(bild, "A1")
        except (LogoFehler, OSError):
            bild = None
    if bild is None:
        blatt["A1"] = d.firma.name if d.firma else ""
        blatt["A1"].font = Font(bold=True, size=14, color="1F3A6E")
    letzte = get_column_letter(len(spalten))
    blatt[f"{letzte}1"] = _projekttext(d)
    blatt[f"{letzte}1"].alignment = Alignment(horizontal="right", vertical="center")
    blatt["A2"] = titel
    blatt["A2"].font = Font(bold=True, size=13, color="1F3A6E")
    blatt["A3"] = f"Stand {datum(datetime.now().astimezone())} · Fachvorgaben-Stand {datum(d.stand_am)} · Status: {d.status_text}"
    for i, (name, breite) in enumerate(spalten, start=1):
        z = blatt.cell(4, i, name)
        z.font, z.fill = WEISS, KOPF
        z.alignment = Alignment(wrap_text=True, vertical="center")
        blatt.column_dimensions[get_column_letter(i)].width = breite
    blatt.freeze_panes = "A5"
    blatt.print_title_rows = "1:4"
    blatt.page_setup.orientation = "landscape"
    blatt.page_setup.fitToWidth = 1
    blatt.page_setup.fitToHeight = 0
    blatt.sheet_properties.pageSetUpPr.fitToPage = True
    zeile1, zeile2 = firmenzeilen(d.firma)
    blatt.oddHeader.right.text = _projekttext(d).replace("&", "&&")
    if d.firma:  # leeres linkes Feld nicht setzen (sonst lesen manche Programme die Kopfzeile falsch)
        blatt.oddHeader.left.text = d.firma.name.replace("&", "&&")
    if zeile1:  # leere Felder nicht setzen (sonst wird die Fußzeile falsch gelesen)
        blatt.oddFooter.center.text = (zeile1 + ("\n" + zeile2 if zeile2 else "")).replace("&", "&&")
    blatt.oddFooter.right.text = "Seite &P von &N"


def _blattstueckliste(mappe: Workbook, d: BerichtDaten, zeilen: list[dict], mit_leistung: bool = True) -> None:
    b = mappe.create_sheet("Blattstückliste")
    spalten = [("Raum-Nr.", 9), ("Geschoss", 12), ("Raum", 24), ("Schlüssel", 22), ("Art.-Nr.", 14), ("Artikel", 36)]
    spalten += [("Leistung je Stück (W)", 12)] if mit_leistung else []
    spalten += [("Menge", 9), ("Einheit", 10)]
    _kopf(b, d, "Blattstückliste (Mengen je Raum)", spalten)
    for i, z in enumerate(zeilen, start=ERSTE_ZEILE):
        werte = [z["raum_nr"] or "", z["geschoss"], z["raum"], z["schluessel"], z["art_nr"], z["artikel"]]
        werte += [z["leistung_w"]] if mit_leistung else []
        werte += [z["menge"], z["einheit"]]
        for s, w in enumerate(werte, start=1):
            b.cell(i, s, w).border = LINIE
    b.column_dimensions["D"].hidden = False


def bestellliste(d: BerichtDaten) -> bytes:
    """Bestellliste ohne Preise: Menge = Summe aus der Blattstückliste (Formel), Zusatz (Reserve) als Eingabe."""
    mappe = Workbook()
    b = mappe.active
    b.title = "Bestellliste"
    zeilen = stueckliste(d)
    _kopf(b, d, "Bestellliste", [("Art.-Nr.", 16), ("Artikel", 40), ("Leistung je Stück (W)", 14), ("Menge laut Blattstückliste", 14),
                                 ("Zusatz (Reserve)", 12), ("Bestellmenge", 13), ("Schlüssel", 22)])
    artikel: dict[str, dict] = {}
    for z in zeilen:
        artikel.setdefault(z["schluessel"], z)
    n = ERSTE_ZEILE
    for schluessel, z in artikel.items():
        b.cell(n, 1, z["art_nr"] or None)
        if not z["art_nr"]:  # nicht im Katalog gepflegt: Eingabefeld
            b.cell(n, 1).fill, b.cell(n, 1).font = GELB, EINGABE
        b.cell(n, 2, z["artikel"])
        b.cell(n, 3, z["leistung_w"])
        b.cell(n, 4, f"=SUMIF('Blattstückliste'!$D:$D,$G{n},'Blattstückliste'!$H:$H)")
        zusatz = b.cell(n, 5, 0)
        zusatz.fill, zusatz.font = GELB, EINGABE
        b.cell(n, 6, f"=D{n}+E{n}").font = FETT
        b.cell(n, 7, schluessel).font = Font(color="808080", size=8)
        for s in range(1, 8):
            b.cell(n, s).border = LINIE
        n += 1
    n += 1
    b.cell(n, 1, "Legende:").font = FETT
    b.cell(n, 2, "Gelbe Zelle mit blauer Schrift = Eingabe (z. B. Art.-Nr., Zusatz als Reserve). Bestellmenge = Menge + Zusatz.")
    b.cell(n, 1).fill = GELB
    b.cell(n + 1, 2, "Mengen aus dem Blatt „Blattstückliste“ (je Raum, aus der Planung). Ohne Preise.")
    _blattstueckliste(mappe, d, zeilen)
    puffer = io.BytesIO()
    mappe.save(puffer)
    return puffer.getvalue()


def kalkulation(d: BerichtDaten, preisstand: dict) -> bytes:
    """Kalkulation intern: alle Zellen mit Formeln; Preise aus dem eingefrorenen Preisstand des Projekts.
    Fehlende Preise: „Preis fehlt“ (nie 0 €); Summen nur aus Positionen mit Preis, mit Warnzeile."""
    mappe = Workbook()
    k = mappe.active
    k.title = "Kalkulation"
    zeilen = stueckliste(d, mit_pauschalen=True)

    # Preise (eingefroren)
    p = mappe.create_sheet("Preise")
    _kopf(p, d, f"Preise (Preisstand vom {preisstand.get('datum', '–')}, Katalogversion {preisstand.get('katalogversion', '–')})",
          [("Schlüssel", 24), ("Art.-Nr.", 14), ("Artikel", 40), ("Einheit", 10), ("EK netto (€)", 13), ("VK netto (€)", 13)])
    preise = dict(preisstand.get("preise", {}))
    for z in zeilen:  # Positionen ohne Katalogeintrag trotzdem aufführen (Preis fehlt)
        preise.setdefault(z["schluessel"], {"art_nr": z["art_nr"], "bezeichnung": z["artikel"], "einheit": z["einheit"], "ek": None, "vk": None})
    n = ERSTE_ZEILE
    for schluessel, w in sorted(preise.items(), key=lambda x: (not x[0].startswith("modul:"), x[0])):
        p.cell(n, 1, schluessel)
        p.cell(n, 2, w.get("art_nr") or None)
        p.cell(n, 3, w.get("bezeichnung"))
        p.cell(n, 4, w.get("einheit"))
        for s, f in ((5, "ek"), (6, "vk")):
            z = p.cell(n, s, w.get(f))
            z.number_format = EURO
        n += 1
    _blattstueckliste(mappe, d, zeilen, mit_leistung=False)

    spalten = [("Raum", 26), ("Position", 34), ("Schlüssel", 20), ("Menge", 8), ("EK je Einheit", 13), ("VK je Einheit", 13), ("EK gesamt", 13),
               ("VK gesamt", 13), ("Marge (€)", 12), ("Marge (%)", 10), ("Hinweis", 14)]
    _kopf(k, d, "Kalkulation intern – vertraulich", spalten)
    k["A3"] = f"{k['A3'].value} · Preisstand vom {preisstand.get('datum', '–')} (Katalogversion {preisstand.get('katalogversion', '–')})"
    k.insert_rows(ERSTE_ZEILE, 1)  # Warnzeile über der Tabelle
    start = ERSTE_ZEILE + 1
    n = start
    preis = "INDEX(Preise!${s}:${s},MATCH($C{n},Preise!$A:$A,0))"
    raum_summen: list[int] = []

    def position(raum: str, z: dict) -> None:
        nonlocal n
        k.cell(n, 1, raum)
        k.cell(n, 2, z["artikel"] + (f" ({z['art_nr']})" if z["art_nr"] else ""))
        k.cell(n, 3, z["schluessel"]).font = Font(color="808080", size=8)
        raum_nr = z["raum_nr"]
        k.cell(n, 4, f"=SUMIFS('Blattstückliste'!$G:$G,'Blattstückliste'!$A:$A,{raum_nr if raum_nr else '\"\"'},'Blattstückliste'!$D:$D,$C{n})")
        for s, sp in ((5, "E"), (6, "F")):
            ref = preis.format(s=sp, n=n)
            k.cell(n, s, f'=IFERROR(IF(ISBLANK({ref}),"Preis fehlt",{ref}),"Preis fehlt")').number_format = EURO
        k.cell(n, 7, f'=IF(ISNUMBER(E{n}),D{n}*E{n},"")').number_format = EURO
        k.cell(n, 8, f'=IF(ISNUMBER(F{n}),D{n}*F{n},"")').number_format = EURO
        k.cell(n, 9, f'=IF(AND(ISNUMBER(G{n}),ISNUMBER(H{n})),H{n}-G{n},"")').number_format = EURO
        k.cell(n, 10, f'=IF(AND(ISNUMBER(I{n}),N(H{n})<>0),I{n}/H{n},"")').number_format = PROZENT
        hinweis = k.cell(n, 11, f'=IF(AND(ISNUMBER(E{n}),ISNUMBER(F{n})),"","Preis fehlt")')
        hinweis.font = Font(color="B42318", bold=True)
        for s in range(1, 12):
            k.cell(n, s).border = LINIE
        n += 1

    def summe(text: str, von: int, bis: int) -> int:
        nonlocal n
        k.cell(n, 1, text).font = FETT
        for s, sp in ((7, "G"), (8, "H"), (9, "I")):
            k.cell(n, s, f"=SUM({sp}{von}:{sp}{bis})").number_format = EURO
        k.cell(n, 10, f'=IF(N(H{n})<>0,I{n}/H{n},"")').number_format = PROZENT
        for s in range(1, 12):
            k.cell(n, s).fill, k.cell(n, s).font = SUMME, FETT
        zeile = n
        n += 2
        return zeile

    raeume: dict[tuple[int, str], list[dict]] = {}
    for z in zeilen:
        raeume.setdefault((z["raum_nr"], z["raum"]), []).append(z)
    for (raum_nr, raum), liste in raeume.items():
        von = n
        for z in liste:
            position(raum if raum_nr else "Projekt", z)
        raum_summen.append(summe(f"Summe {raum if raum_nr else 'Projekt (Anfahrt)'}", von, n - 1))
    # Gesamt: nur aus den Raumsummen (diese enthalten nur Positionen mit Preis)
    k.cell(n, 1, "Gesamt (nur Positionen mit Preis)").font = FETT
    for s, sp in ((7, "G"), (8, "H"), (9, "I")):
        k.cell(n, s, "=" + "+".join(f"{sp}{z}" for z in raum_summen) if raum_summen else 0).number_format = EURO
    k.cell(n, 10, f'=IF(N(H{n})<>0,I{n}/H{n},"")').number_format = PROZENT
    for s in range(1, 12):
        k.cell(n, s).fill, k.cell(n, s).font = KOPF, WEISS
    # Warnzeile oben
    warn = k.cell(ERSTE_ZEILE, 1, f'=IF(COUNTIF(K{start}:K{n},"Preis fehlt")>0,"Achtung: "&COUNTIF(K{start}:K{n},"Preis fehlt")&'
                                  f'" Position(en) ohne Preis – Summen enthalten nur Positionen mit Preis.","Alle Positionen haben einen Preis.")')
    warn.font = Font(bold=True, color="B42318")
    for s in range(1, 12):
        k.cell(ERSTE_ZEILE, s).fill = WARN
    k.cell(n + 2, 1, "Marge = (VK − EK) / VK, netto. Montagezeit ist nicht enthalten. Preise aus dem eingefrorenen Preisstand des Projekts (Blatt „Preise“).")
    puffer = io.BytesIO()
    mappe.save(puffer)
    return puffer.getvalue()
