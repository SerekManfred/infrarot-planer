"""Ergebnisbericht als PDF (Paket M4a, 02.11.2026) – ohne Preise.

Kopfzeile: Logo links (max. 15 mm hoch, Seitenverhältnis erhalten; ohne Logo der Firmenname), rechts
„Projekt <Nr> · <Kunde>“, feine Linie. Fußzeile: Firmendaten (zwei Zeilen), Fachvorgaben-Stand, Status,
„Seite x von y“. Wasserzeichen „ENTWURF“, solange das Projekt nicht fachlich geprüft oder freigegeben ist.
Schrift DejaVu Sans (eingebettet) für m², Umlaute und Sonderzeichen.
"""
import io
import math
import os
from datetime import datetime

from PIL import Image as PilImage
from reportlab.graphics.shapes import Circle, Drawing, Group, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import CondPageBreak, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.berichte.daten import (
    HERKUNFT_TEXT, HINWEISE_ALLGEMEIN, QUELLE_TEXT, BerichtDaten, RaumBericht, datum, firmenzeilen, raumhinweise, raumstatus,
    watt, zahl,
)
from app.logo import LogoFehler, pfad as logo_pfad

SCHRIFTORDNER = os.environ.get("INFRAROT_SCHRIFTEN", "/usr/share/fonts/truetype/dejavu")
SCHRIFT, FETT = "DejaVuSans", "DejaVuSans-Bold"
BLAU = colors.HexColor("#1f3a6e")
GRAU = colors.HexColor("#5d6878")
RAND_LINKS = RAND_RECHTS = 18 * mm
RAND_OBEN, RAND_UNTEN = 28 * mm, 30 * mm
BREITE = A4[0] - RAND_LINKS - RAND_RECHTS
MASSSTAEBE = (20, 25, 50, 75, 100, 150, 200, 250, 500)
PLAN_MAX_B, PLAN_MAX_H = BREITE - 16 * mm, 55 * mm


def _schriften() -> None:
    if SCHRIFT in pdfmetrics.getRegisteredFontNames():
        return
    pdfmetrics.registerFont(TTFont(SCHRIFT, os.path.join(SCHRIFTORDNER, "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont(FETT, os.path.join(SCHRIFTORDNER, "DejaVuSans-Bold.ttf")))


def _stile() -> dict[str, ParagraphStyle]:
    basis = ParagraphStyle("basis", fontName=SCHRIFT, fontSize=9, leading=12, textColor=colors.black)
    return {
        "basis": basis,
        "klein": ParagraphStyle("klein", parent=basis, fontSize=7.5, leading=9.5),
        "titel": ParagraphStyle("titel", parent=basis, fontName=FETT, fontSize=16, leading=20, textColor=BLAU, spaceAfter=4 * mm),
        "h2": ParagraphStyle("h2", parent=basis, fontName=FETT, fontSize=11, leading=14, textColor=BLAU, spaceBefore=4 * mm, spaceAfter=2 * mm),
        "zelle": ParagraphStyle("zelle", parent=basis, fontSize=8, leading=10),
        "zelle_fett": ParagraphStyle("zelle_fett", parent=basis, fontName=FETT, fontSize=8, leading=10),
    }


def _tabelle(daten, breiten, kopf=True, zahlspalten=()) -> Table:
    t = Table(daten, colWidths=breiten, repeatRows=1 if kopf else 0)
    stil = [
        ("FONT", (0, 0), (-1, -1), SCHRIFT, 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#d5dbe5")),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]
    if kopf:
        stil += [("FONT", (0, 0), (-1, 0), FETT, 8), ("BACKGROUND", (0, 0), (-1, 0), BLAU), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]
    for s in zahlspalten:
        stil.append(("ALIGN", (s, 0), (s, -1), "RIGHT"))
    t.setStyle(TableStyle(stil))
    return t


# ── Kopf, Fuß, Wasserzeichen, „Seite x von y“ ──

def _seitenrahmen(d: BerichtDaten):
    logo = None
    if d.firma and d.firma.logo_datei:
        try:
            p = logo_pfad(d.firma.logo_datei)
            if p.exists():
                with PilImage.open(p) as b:
                    w, h = b.size
                hoehe = 15 * mm
                breite = hoehe * w / h
                if breite > 60 * mm:  # sehr breite Logos: Breite begrenzen, Seitenverhältnis bleibt
                    breite, hoehe = 60 * mm, 60 * mm * h / w
                logo = (str(p), breite, hoehe)
        except (LogoFehler, OSError):
            logo = None
    zeile1, zeile2 = firmenzeilen(d.firma)
    projekt = f"Projekt {d.projekt.nummer}" + (f" · {d.projekt.kunde_name}" if d.projekt.kunde_name.strip() else "")
    meta = f"Fachvorgaben-Stand {datum(d.stand_am)} · Status: {d.status_text}"
    entwurf = d.projekt.status == "entwurf"

    class Seiten(rl_canvas.Canvas):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._seiten = []

        def showPage(self):  # noqa: N802 – ReportLab-Name
            self._seiten.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            gesamt = len(self._seiten)
            for zustand in self._seiten:
                self.__dict__.update(zustand)
                self._rahmen(gesamt)
                super().showPage()
            super().save()

        def _rahmen(self, gesamt: int) -> None:
            b, h = A4
            self.saveState()
            if entwurf:
                self.setFont(FETT, 90)
                self.setFillColor(colors.Color(0.85, 0.85, 0.85, alpha=0.45))
                self.translate(b / 2, h / 2)
                self.rotate(45)
                self.drawCentredString(0, -30, "ENTWURF")
                self.rotate(-45)
                self.translate(-b / 2, -h / 2)
            oben = h - 10 * mm
            if logo:
                self.drawImage(logo[0], RAND_LINKS, oben - logo[2], width=logo[1], height=logo[2], mask="auto")
            else:
                self.setFont(FETT, 11)
                self.setFillColor(BLAU)
                self.drawString(RAND_LINKS, oben - 8 * mm, d.firma.name if d.firma else "")
            self.setFillColor(colors.black)
            self.setFont(SCHRIFT, 9)
            self.drawRightString(b - RAND_RECHTS, oben - 8 * mm, projekt)
            self.setStrokeColor(GRAU)
            self.setLineWidth(0.4)
            self.line(RAND_LINKS, oben - 16.5 * mm, b - RAND_RECHTS, oben - 16.5 * mm)
            self.line(RAND_LINKS, 24 * mm, b - RAND_RECHTS, 24 * mm)
            self.setFont(SCHRIFT, 7)
            self.setFillColor(colors.HexColor("#333b47"))
            self.drawCentredString(b / 2, 20 * mm, zeile1)
            if zeile2:
                self.drawCentredString(b / 2, 16.5 * mm, zeile2)
            self.drawString(RAND_LINKS, 11 * mm, meta)
            self.drawRightString(b - RAND_RECHTS, 11 * mm, f"Seite {self._pageNumber} von {gesamt}")
            self.restoreState()

    return Seiten


# ── Deckenplan ──

def _massstab(d: BerichtDaten) -> int:
    """Einheitlicher Maßstab für alle Räume: der kleinste, bei dem der größte Raum in den Planbereich passt."""
    groesste_b = groesste_h = 0.0
    for rb in d.raeume:
        for ring in rb.a.get("umriss") or []:
            xs, ys = [p["x"] for p in ring], [p["y"] for p in ring]
            groesste_b, groesste_h = max(groesste_b, max(xs) - min(xs)), max(groesste_h, max(ys) - min(ys))
    for s in MASSSTAEBE:
        k = 1000 / s * mm  # Punkte je Meter
        if groesste_b * k <= PLAN_MAX_B and groesste_h * k <= PLAN_MAX_H:
            return s
    return MASSSTAEBE[-1]


def _schraffur(zeichnung: Drawing, x0: float, y0: float, x1: float, y1: float, farbe, abstand: float = 2.2 * mm) -> None:
    """45°-Schraffur im Rechteck (Linien auf das Rechteck zugeschnitten)."""
    b, h = x1 - x0, y1 - y0
    c = -h
    while c < b:
        # Linie x = y + c (lokal), geschnitten mit [0, b] × [0, h]
        ya, yb = max(0.0, -c), min(h, b - c)
        if yb > ya:
            zeichnung.add(Line(x0 + ya + c, y0 + ya, x0 + yb + c, y0 + yb, strokeColor=farbe, strokeWidth=0.5))
        c += abstand


def _plan(d: BerichtDaten, rb: RaumBericht, s: int) -> Drawing | None:
    ringe = rb.a.get("umriss") or []
    if not ringe:
        return None
    k = 1000 / s * mm
    rand = 9 * mm
    xs = [p["x"] for r in ringe for p in r]
    ys = [p["y"] for r in ringe for p in r]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    zb, zh = (x1 - x0) * k + 2 * rand, (y1 - y0) * k + 2 * rand
    z = Drawing(zb, zh)

    def P(x: float, y: float) -> tuple[float, float]:  # Planmeter (y nach unten) → Zeichnungspunkte (y nach oben)
        return rand + (x - x0) * k, zh - rand - (y - y0) * k

    for ring in ringe:
        punkte = [v for p in ring for v in P(p["x"], p["y"])]
        z.add(Polygon(punkte, fillColor=colors.white, strokeColor=colors.black, strokeWidth=1.8))
        # Bemaßung je Wandsegment, außen neben dem Segment
        for i, p in enumerate(ring):
            q = ring[(i + 1) % len(ring)]
            laenge = math.hypot(q["x"] - p["x"], q["y"] - p["y"])
            dx, dy = (q["x"] - p["x"]) / laenge, (q["y"] - p["y"]) / laenge
            ax, ay = dy, -dx  # nach außen (Raum liegt rechts der Laufrichtung)
            mx, my = P((p["x"] + q["x"]) / 2 + ax * 3.5 * mm / k, (p["y"] + q["y"]) / 2 + ay * 3.5 * mm / k)
            if abs(dx) < 0.5:  # senkrechtes Segment: Text gedreht
                g = Group(String(0, -2, f"{zahl(laenge)} m", fontName=SCHRIFT, fontSize=6.5, textAnchor="middle"))
                g.transform = (0, 1, -1, 0, mx, my)
                z.add(g)
            else:
                z.add(String(mx, my - 2, f"{zahl(laenge)} m", fontName=SCHRIFT, fontSize=6.5, textAnchor="middle"))
    # Türen und Fenster
    L, B = rb.raum.laenge_m or 0, rb.raum.breite_m or 0
    for o in rb.raum.tueren_fenster or []:
        w, pos, br = o["wand"], o["position"], o["breite"]
        # Wandlinie: Hauptrechteck oder Segment der Raumform (Paket N2)
        li = o.get("linie")
        li = li if li is not None else {"oben": 0, "unten": B, "links": 0, "rechts": L}[w]
        a, e = ((pos, li), (pos + br, li)) if w in ("oben", "unten") else ((li, pos), (li, pos + br))
        farbe = colors.HexColor("#e8662a") if o["art"] == "tuer" else colors.HexColor("#3b82c4")
        z.add(Line(*P(*a), *P(*e), strokeColor=farbe, strokeWidth=3.2))
    # Objekte (Sperrflächen) nach Kategorie
    for sp in rb.raum.sperrflaechen or []:
        obj = d.objekte.get(sp.get("objekt") or sp.get("typ") or "", {})
        kat = sp.get("kategorie") or obj.get("kategorie", "tabu")  # eigene Kategorie der Sonstigen Sperrfläche (Paket N4)
        name = (sp.get("bezeichnung") or "").strip() or obj.get("name", "")
        if sp.get("umriss") == "rund":
            r = sp["b"] / 2
            cx, cy = P(sp["x"] + r, sp["y"] + r)
            farbe, fuell = {"tabu": ("#b42318", colors.Color(0.71, 0.14, 0.09, alpha=0.12)), "abstand": ("#e8662a", colors.Color(0.91, 0.4, 0.16, alpha=0.18))}.get(
                kat, ("#5d6878", colors.Color(0.5, 0.5, 0.5, alpha=0.15)))
            z.add(Circle(cx, cy, r * k, fillColor=fuell, strokeColor=colors.HexColor(farbe), strokeWidth=0.8, strokeDashArray=[2, 1.5] if kat == "neutral" else None))
            if kat == "tabu":  # Schraffur im Kreis: Linien auf den Kreis zugeschnitten
                c = -2 * r * k
                while c < 2 * r * k:
                    # Linie y − cy = (x − cx) + c, Schnitt mit dem Kreis
                    disk = 2 * (r * k) ** 2 - c * c
                    if disk > 0:
                        w = math.sqrt(disk)
                        x1, x2 = (-c - w) / 2, (-c + w) / 2
                        z.add(Line(cx + x1, cy + x1 + c, cx + x2, cy + x2 + c, strokeColor=colors.HexColor(farbe), strokeWidth=0.5))
                    c += 2.2 * mm
            if 2 * r * k > 14 * mm:
                z.add(String(cx, cy - 2, name[:30], fontName=SCHRIFT, fontSize=6, textAnchor="middle"))
            continue
        if sp.get("b", 0) <= 0 and sp.get("t", 0) <= 0:
            cx, cy = P(sp["x"], sp["y"])
            z.add(Circle(cx, cy, 1.6 * mm, fillColor=colors.HexColor("#8a5a00"), strokeColor=colors.black, strokeWidth=0.4))
            continue
        ax, ay = P(sp["x"], sp["y"] + sp["t"])
        bx, by = P(sp["x"] + sp["b"], sp["y"])
        if kat == "tabu":
            z.add(Rect(ax, ay, bx - ax, by - ay, fillColor=colors.Color(0.71, 0.14, 0.09, alpha=0.08), strokeColor=colors.HexColor("#b42318"), strokeWidth=0.8))
            _schraffur(z, ax, ay, bx, by, colors.HexColor("#b42318"))
        elif kat == "abstand":
            z.add(Rect(ax, ay, bx - ax, by - ay, fillColor=colors.Color(0.91, 0.4, 0.16, alpha=0.18), strokeColor=colors.HexColor("#e8662a"), strokeWidth=0.8))
        else:
            z.add(Rect(ax, ay, bx - ax, by - ay, fillColor=colors.Color(0.5, 0.5, 0.5, alpha=0.15), strokeColor=GRAU, strokeWidth=0.6, strokeDashArray=[2, 1.5]))
        if bx - ax > 14 * mm and by - ay > 4 * mm:
            z.add(String((ax + bx) / 2, (ay + by) / 2 - 2, name[:30], fontName=SCHRIFT, fontSize=6, textAnchor="middle"))
    # Module mit Typ und Leistung
    for i, m in enumerate(rb.raum.module or []):
        b, t = (m["breite_m"], m["laenge_m"]) if m.get("gedreht") else (m["laenge_m"], m["breite_m"])
        ax, ay = P(m["x"], m["y"] + t)
        bx, by = P(m["x"] + b, m["y"])
        z.add(Rect(ax, ay, bx - ax, by - ay, fillColor=colors.HexColor("#5a73a5"), strokeColor=BLAU, strokeWidth=0.8))
        mx, my = (ax + bx) / 2, (ay + by) / 2
        if bx - ax > 13 * mm and by - ay > 6 * mm:
            z.add(String(mx, my + 0.5, f"{i + 1}: {m['artikel_nr']}", fontName=FETT, fontSize=5.8, textAnchor="middle", fillColor=colors.white))
            z.add(String(mx, my - 6, watt(m["leistung_w"]), fontName=SCHRIFT, fontSize=5.8, textAnchor="middle", fillColor=colors.white))
        else:
            z.add(String(mx, my - 2, str(i + 1), fontName=FETT, fontSize=6.5, textAnchor="middle", fillColor=colors.white))
    return z


def _raumblatt(d: BerichtDaten, rb: RaumBericht, s: int, st: dict) -> list:
    a, m = rb.a, rb.a.get("modulplanung") or {}
    kopf = Table([[
        Paragraph(f"<b>{rb.nr}. {a['bezeichnung']}</b> · {rb.geschoss}", st["zelle"]),
        Paragraph(f"Fläche {zahl(a.get('flaeche_m2'))} m² · Höhe {zahl(a.get('hoehe_m'))} m", st["zelle"]),
        Paragraph(f"<b>Status: {raumstatus(a)}</b>", st["zelle"]),
    ]], colWidths=[BREITE * 0.45, BREITE * 0.35, BREITE * 0.2])
    kopf.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#e8eef8")), ("ALIGN", (2, 0), (2, 0), "RIGHT"),
                              ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    teile = [kopf, Spacer(1, 1.5 * mm)]
    plan = _plan(d, rb, s)
    if plan is not None:
        teile.append(plan)
    # Sonstige Sperrflächen mit eigenem Namen und Form (Paket N4) in der Legende des Raums
    sonstige = [sp for sp in rb.raum.sperrflaechen or [] if (sp.get("objekt") or sp.get("typ")) == "sonstiges"]
    formtext = {"rechteck": "Rechteck", "quadrat": "Quadrat", "rund": "rund"}
    kattext = {"tabu": "tabu", "abstand": "Abstand", "neutral": "neutral"}
    zusatz = "; ".join(
        f"{(sp.get('bezeichnung') or 'Sonstige Sperrfläche').strip()} ({formtext.get(sp.get('umriss') or 'rechteck')}"
        f"{', Ø ' + zahl(sp['b']) + ' m' if sp.get('umriss') == 'rund' else ''}, {kattext.get(sp.get('kategorie') or 'tabu')})"
        for sp in sonstige
    )
    teile.append(Paragraph(f"Maßstab 1:{s} – Legende siehe oben" + (f" · Sonstige Sperrflächen: {zusatz}" if zusatz else ""), st["klein"]))
    herkunft = HERKUNFT_TEXT.get((a.get("werte") or {}).get("pauschale_w_m2", {}).get("herkunft"), "")
    quelle = QUELLE_TEXT.get(a.get("quelle"), a.get("quelle") or "")
    raumdaten = [
        ["Raumtyp", a.get("raumtyp") or "–"],
        ["Heizlast", f"{watt(a.get('phi_massgeblich_w'))} ({quelle}{', ' + herkunft if herkunft and a.get('quelle') == 'A' else ''})"],
        ["Modulleistung", watt(m.get("installiert_w"))],
        ["Reserve", "–" if m.get("reserve_prozent") is None else f"{zahl(m['reserve_prozent'], 0)} %"],
        ["Thermostat", str(m.get("thermostate", 0))],
    ]
    stueck = [["Position", "Menge", "Leistung"]]
    for t in m.get("typen") or []:
        stueck.append([f"{t['artikel_nr']} {t['bezeichnung']}", str(t["anzahl"]), watt(t["leistung_w"] * t["anzahl"])])
    if m.get("thermostate"):
        stueck.append(["Raumthermostat", str(m["thermostate"]), ""])
    links = _tabelle([[Paragraph(f"<b>{k}</b>", st["zelle"]), Paragraph(v, st["zelle"])] for k, v in raumdaten], [28 * mm, 58 * mm], kopf=False)
    rechts = _tabelle([[Paragraph(str(c), st["zelle"]) for c in z] for z in stueck], [52 * mm, 14 * mm, 20 * mm], zahlspalten=(1, 2)) if len(stueck) > 1 else Paragraph("Keine Module geplant.", st["zelle"])
    nebeneinander = Table([[links, rechts]], colWidths=[BREITE / 2, BREITE / 2])
    nebeneinander.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    teile += [Spacer(1, 1.5 * mm), nebeneinander]
    hinweise = raumhinweise(d, rb)
    if hinweise:
        teile.append(Paragraph("<br/>".join(f"• {h}" for h in hinweise), st["zelle"]))
    teile.append(Spacer(1, 6 * mm))
    # Raum nicht über den Seitenwechsel teilen: Umbruch nur, wenn der Raum nicht mehr ganz passt (2–3 Räume je Seite)
    hoehe = (plan.height if plan is not None else 0) + 40 * mm + 4 * mm * len(hinweise)
    return [CondPageBreak(hoehe), *teile]


def erzeugen(d: BerichtDaten) -> bytes:
    _schriften()
    st = _stile()
    puffer = io.BytesIO()
    doc = SimpleDocTemplate(puffer, pagesize=A4, leftMargin=RAND_LINKS, rightMargin=RAND_RECHTS, topMargin=RAND_OBEN, bottomMargin=RAND_UNTEN,
                            title=f"Ergebnisbericht {d.projekt.nummer}", author=d.firma.name if d.firma else "", subject="Infrarot-Deckenheizung")
    p, s = d.projekt, d.summe
    inhalt = [Paragraph("Ergebnisbericht Infrarot-Deckenheizung", st["titel"])]
    block = [
        ["Projektnummer", p.nummer, "Gebäudestandard", d.standard_text],
        ["Kunde", p.kunde_name or "–", "Zuständig", d.zustaendig],
        ["Projekt / Objekt", f"{p.bezeichnung} / {d.objekt_bezeichnung}", "Fachvorgaben-Stand", datum(d.stand_am)],
        ["Status", d.status_text, "Datum", datum(datetime.now().astimezone())],
    ]
    inhalt.append(_tabelle([[Paragraph(f"<b>{z[0]}</b>", st["zelle"]), Paragraph(z[1], st["zelle"]), Paragraph(f"<b>{z[2]}</b>", st["zelle"]),
                             Paragraph(z[3], st["zelle"])] for z in block], [30 * mm, 57 * mm, 32 * mm, 55 * mm], kopf=False))
    inhalt.append(Paragraph("Kennzahlen", st["h2"]))
    reserve = "–" if s.get("reserve_w") is None else f"{watt(s['reserve_w'])} ({zahl(s['reserve_prozent'], 0)} %)"
    kenn = [["Räume", "Fläche", "Heizlast gesamt", "Modulleistung", "Reserve gesamt", "Module"],
            [str(len(d.raeume)), f"{zahl(s.get('flaeche_m2'))} m²", watt(s.get("phi_massgeblich_w")), watt(s.get("installiert_w")), reserve, str(s.get("module", 0))]]
    inhalt.append(_tabelle(kenn, [BREITE / 6] * 6))
    inhalt.append(Paragraph("Raumübersicht", st["h2"]))
    zeilen = [["Nr", "Raum", "Fläche", "Höhe", "Heizlast", "Module", "Leistung", "Reserve", "Status"]]
    for rb in d.raeume:
        a, m = rb.a, rb.a.get("modulplanung") or {}
        zeilen.append([str(rb.nr), Paragraph(f"{a['bezeichnung']} <font size=6.5>({rb.geschoss})</font>", st["zelle"]), f"{zahl(a.get('flaeche_m2'))} m²",
                       f"{zahl(a.get('hoehe_m'))} m", watt(a.get("phi_massgeblich_w")), str(m.get("anzahl", 0)), watt(m.get("installiert_w")),
                       "–" if m.get("reserve_prozent") is None else f"{zahl(m['reserve_prozent'], 0)} %", raumstatus(a)])
    inhalt.append(_tabelle(zeilen, [8 * mm, 46 * mm, 18 * mm, 14 * mm, 20 * mm, 13 * mm, 20 * mm, 16 * mm, 19 * mm], zahlspalten=(0, 2, 3, 4, 5, 6, 7)))
    inhalt.append(Paragraph("Status: OK = Reserve 0 bis 20 %; Prüfen = Reserve über 20 %; Unterdeckt = Modulleistung unter der Heizlast.", st["klein"]))
    inhalt.append(Paragraph("Hinweise", st["h2"]))
    wand = (d.regeln.get("abstand_wand_cm") or {}).get("wert")
    modul = (d.regeln.get("abstand_modul_cm") or {}).get("wert")
    regeln = (f"Planungsregeln: Mindestabstand Modul – Wand {zahl(wand, 0) if wand is not None else '–'} cm, Modul – Modul "
              f"{zahl(modul, 0) if modul is not None else '–'} cm; Abstände zu Möbeln und Einbauten laut Objektbibliothek "
              "(tabu = nie darüber, Abstand = Mindestabstand zur Kante).")
    for h in (*HINWEISE_ALLGEMEIN, regeln):
        inhalt.append(Paragraph(f"• {h}", st["basis"]))
    inhalt.append(Paragraph("Prüfvermerk", st["h2"]))
    inhalt.append(Paragraph(f"{d.pruefvermerk} · Status: {d.status_text}", st["basis"]))
    if d.raeume:
        inhalt.append(PageBreak())
        s_mass = _massstab(d)
        inhalt.append(Paragraph("Raumblätter", st["titel"]))
        inhalt.append(Paragraph(
            f"<b>Legende:</b> Maßstab 1:{s_mass} in allen Raumblättern · Module blau mit Nummer, Typ und Leistung · rot schraffiert = tabu "
            "(nie ein Modul darüber) · orange = Abstand (Mindestabstand zur Kante, meist 30 cm) · grau gestrichelt = neutral · Punkte = "
            "Deckeneinbauten · Türen orange, Fenster blau an der Wand · Thermostat: 1 je Raum mit Modulen, Lage vor Ort festlegen.", st["klein"]))
        inhalt.append(Spacer(1, 3 * mm))
        for rb in d.raeume:
            inhalt.extend(_raumblatt(d, rb, s_mass, st))
    doc.build(inhalt, canvasmaker=_seitenrahmen(d))
    return puffer.getvalue()
