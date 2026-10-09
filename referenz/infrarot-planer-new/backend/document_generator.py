"""
Dokument-Generator v1.3.2
Grundriss wird Schritt für Schritt aus verifizierten Maßen gezeichnet:
  Schritt 1: Äußere Außenwandfläche (grau gefüllt)
  Schritt 2: Innenraum weiß -> Außenwand bleibt sichtbar
  Schritt 3: Innenwände als graue Streifen
  Schritt 4: Raumflächen leicht eingefärbt (sehr transparent)
  Schritt 5: Außenwand-Kontur (dicke Linie)
  Schritt 6: Module einzeichnen
Optional: Original-PDF als sehr heller Hintergrund
"""
import logging, io, base64 as b64mod
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional
logger = logging.getLogger(__name__)

# ── Farben ────────────────────────────────────────────────────────
C_WALL_FILL = (0.78, 0.78, 0.78)   # Außenwand grau
C_IW_FILL   = (0.70, 0.70, 0.70)   # Innenwand dunkelgrau
C_ROOM_STD  = (0.88, 0.94, 1.00)   # Raumfläche Standard
C_ROOM_BATH = (0.82, 0.97, 0.88)   # Raumfläche Bad/WC
C_MOD       = (0.90, 0.40, 0.05)   # Modul Orange
C_MOD_B     = (0.65, 0.25, 0.00)   # Modul Rand
C_CORN      = (0.15, 0.35, 0.85)   # Eckfenster-Modul Blau
C_TEXT      = (0.08, 0.08, 0.08)
ROOM_OPA    = 0.22   # Sehr transparent
MOD_OPA     = 0.85


class DocumentGenerator:
    def __init__(self, settings, rules, modules):
        self.settings = settings
        self.rules = rules
        self.modules = modules if modules else []

    # ── Word-Angebot ──────────────────────────────────────────────
    def create_offer(self, project, output_path):
        try:
            from docx import Document
            from docx.shared import Pt, Cm, RGBColor
            from docx.enum.text import WD_ALIGN_PARAGRAPH
        except ImportError:
            raise ImportError("python-docx nicht installiert.")
        doc = Document()
        for s in doc.sections:
            s.top_margin=Cm(2); s.bottom_margin=Cm(2)
            s.left_margin=Cm(2.5); s.right_margin=Cm(2.5)
        self._add_header(doc, project)
        self._add_offer_meta(doc, project)
        self._add_customer_address(doc, project)
        doc.add_paragraph()
        doc.add_paragraph().add_run("Angebot - Infrarot-Heizungsanlage").bold = True
        doc.add_paragraph().add_run(f"Bauvorhaben: {project.get('project_name','')}")
        doc.add_paragraph()
        self._add_module_cost_table(doc, project)
        doc.add_paragraph()
        self._add_cost_summary(doc, project)
        for floor in project.get("floors", []):
            doc.add_paragraph()
            self._add_floor_section(doc, floor)
        doc.add_paragraph()
        self._add_footer_notes(doc)
        doc.save(output_path)

    def _add_floor_section(self, doc, floor):
        from docx.shared import Pt, Cm
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        fn = floor.get("floor_name", "Geschoss")
        h = doc.add_paragraph()
        h.add_run(f"Grundrissplan - {fn}").bold = True
        h.runs[0].font.size = Pt(12)
        png = self._render_plan(floor)
        if png:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.add_run().add_picture(png, width=Cm(16))
        else:
            doc.add_paragraph().add_run("Kein Plan verfuegbar.").italic = True
        doc.add_paragraph()
        if floor.get("rooms"):
            doc.add_paragraph().add_run(f"Heizlastberechnung - {fn}").bold = True
            self._add_heat_table(doc, floor)

    # ═══════════════════════════════════════════════════════════════
    # GRUNDRISS ZEICHNEN
    # ═══════════════════════════════════════════════════════════════
    def _render_plan(self, floor) -> Optional[io.BytesIO]:
        try:
            import fitz
        except ImportError:
            return None

        rooms = floor.get("rooms", [])
        if not rooms:
            return None

        hw_cm   = float(floor.get("house_width_cm")  or 1000)
        hh_cm   = float(floor.get("house_height_cm") or 1000)
        wall_cm = float(floor.get("wall_thickness_cm") or 34)

        # Ausgabegröße: quadratisches Haus -> quadratisches Bild
        OUT_W = 900.0
        OUT_H = OUT_W * hh_cm / hw_cm
        MARGIN = 20.0

        sx = (OUT_W - 2*MARGIN) / hw_cm
        sy = (OUT_H - 2*MARGIN) / hh_cm
        ox = MARGIN
        oy = MARGIN

        pdf = fitz.open()
        page = pdf.new_page(width=OUT_W, height=OUT_H)

        # ── Optional: Original-PDF als sehr heller Hintergrund ──
        pdf_bytes = self._load_pdf_bytes(floor)
        if pdf_bytes:
            try:
                x0p = float(floor.get("house_x0_percent") or 8)
                y0p = float(floor.get("house_y0_percent") or 10)
                x1p = float(floor.get("house_x1_percent") or 92)
                y1p = float(floor.get("house_y1_percent") or 88)
                orig = fitz.open(stream=pdf_bytes, filetype="pdf")
                pw = float(orig[0].rect.width)
                ph = float(orig[0].rect.height)
                src = fitz.Rect(pw*x0p/100, ph*y0p/100, pw*x1p/100, ph*y1p/100)
                dst = fitz.Rect(ox, oy, ox+(hw_cm)*sx, oy+(hh_cm)*sy)
                page.show_pdf_page(dst, orig, 0, clip=src, keep_proportion=False)
                # Aufhellen
                page.draw_rect(dst, fill=(1,1,1), fill_opacity=0.55, width=0)
            except Exception as e:
                logger.debug(f"PDF-Hintergrund: {e}")
                page.draw_rect(fitz.Rect(0,0,OUT_W,OUT_H), fill=(1,1,1))
        else:
            page.draw_rect(fitz.Rect(0,0,OUT_W,OUT_H), fill=(1,1,1))

        mod_dims = {m["model"]: m for m in self.modules}

        # ════════════════════════════════════════════════════════
        # SCHRITT 1: Äußere Außenwandfläche (ganzes Haus grau)
        # ════════════════════════════════════════════════════════
        page.draw_rect(
            fitz.Rect(ox, oy, ox+hw_cm*sx, oy+hh_cm*sy),
            color=None, fill=C_WALL_FILL, fill_opacity=1.0, width=0
        )

        # ════════════════════════════════════════════════════════
        # SCHRITT 2: Innere Außenwandfläche weiß -> Wand bleibt grau
        # ════════════════════════════════════════════════════════
        page.draw_rect(
            fitz.Rect(ox+wall_cm*sx, oy+wall_cm*sy,
                      ox+(hw_cm-wall_cm)*sx, oy+(hh_cm-wall_cm)*sy),
            color=None, fill=(1,1,1), fill_opacity=1.0, width=0
        )

        # ════════════════════════════════════════════════════════
        # SCHRITT 3: Innenwände einzeichnen
        # ════════════════════════════════════════════════════════
        for w in (floor.get("inner_walls") or []):
            wx0 = ox + float(w.get("x0",0))*sx
            wy0 = oy + float(w.get("y0",0))*sy
            wx1 = ox + float(w.get("x1",0))*sx
            wy1 = oy + float(w.get("y1",0))*sy
            page.draw_rect(
                fitz.Rect(wx0, wy0, wx1, wy1),
                color=None, fill=C_IW_FILL, fill_opacity=1.0, width=0
            )

        # ════════════════════════════════════════════════════════
        # SCHRITT 4: Raumflächen (sehr transparent, Farbe nach Typ)
        # ════════════════════════════════════════════════════════
        for r in rooms:
            x0c = float(r.get("x_cm")  or 0)
            y0c = float(r.get("y_cm")  or 0)
            x1c = float(r.get("x1_cm") or (x0c + float(r.get("width_cm")  or 100)))
            y1c = float(r.get("y1_cm") or (y0c + float(r.get("height_cm") or 100)))

            rx0=ox+x0c*sx; ry0=oy+y0c*sy
            rx1=ox+x1c*sx; ry1=oy+y1c*sy
            rw=rx1-rx0; rh=ry1-ry0

            fill = C_ROOM_BATH if r.get("room_type")=="bathroom" else C_ROOM_STD
            page.draw_rect(fitz.Rect(rx0,ry0,rx1,ry1),
                          fill=fill, fill_opacity=ROOM_OPA, color=None, width=0)

            name = r.get("name","")
            area = float(r.get("area_m2") or (x1c-x0c)*(y1c-y0c)/10000)
            fs = max(5.0, min(9.0, min(rw,rh)*0.11))
            page.insert_textbox(
                fitz.Rect(rx0+2, ry0+2, rx1-2, ry1-2),
                f"{name}\n{area:.2f} m²",
                fontsize=fs, color=C_TEXT, align=1
            )

        # ════════════════════════════════════════════════════════
        # SCHRITT 5: Außenwand-Kontur (dicke schwarze Linie)
        # ════════════════════════════════════════════════════════
        wall_lw = max(1.5, wall_cm * sx * 0.12)
        page.draw_rect(
            fitz.Rect(ox, oy, ox+hw_cm*sx, oy+hh_cm*sy),
            color=(0,0,0), fill=None, width=wall_lw
        )

        # ════════════════════════════════════════════════════════
        # SCHRITT 6: Module einzeichnen
        # ════════════════════════════════════════════════════════
        for r in rooms:
            x0c = float(r.get("x_cm")  or 0)
            y0c = float(r.get("y_cm")  or 0)
            x1c = float(r.get("x1_cm") or (x0c + float(r.get("width_cm")  or 100)))
            y1c = float(r.get("y1_cm") or (y0c + float(r.get("height_cm") or 100)))

            mx_cm  = float(r.get("module_x_cm")  or ((x0c+x1c)/2))
            my_cm  = float(r.get("module_y_cm")  or ((y0c+y1c)/2))
            mx2_cm = r.get("module_x2_cm")
            my2_cm = r.get("module_y2_cm")

            mods = r.get("modules") or []
            flat = []
            for mod in mods:
                for _ in range(mod.get("quantity",1)): flat.append(mod)
            if not flat: continue

            for idx, mod in enumerate(flat):
                mi = mod_dims.get(mod.get("model"))
                if not mi: continue
                mw = mi["width_cm"]*sx
                mh = mi["height_cm"]*sy

                if len(flat)==2 and idx==1 and mx2_cm and my2_cm:
                    cx = ox + float(mx2_cm)*sx
                    cy = oy + float(my2_cm)*sy
                else:
                    cx = ox + mx_cm*sx
                    cy = oy + my_cm*sy

                x0m=cx-mw/2; y0m=cy-mh/2
                x1m=x0m+mw;  y1m=y0m+mh

                # Innerhalb des Raums halten
                rx0=ox+x0c*sx+1; ry0=oy+y0c*sy+1
                rx1=ox+x1c*sx-1; ry1=oy+y1c*sy-1
                x0m=max(rx0, min(rx1-mw, x0m))
                y0m=max(ry0, min(ry1-mh, y0m))
                x1m=x0m+mw; y1m=y0m+mh

                fill  = C_CORN if mod.get("is_corner_module") else C_MOD
                bord  = (0.1,0.2,0.7) if mod.get("is_corner_module") else C_MOD_B
                page.draw_rect(fitz.Rect(x0m,y0m,x1m,y1m),
                               color=bord, fill=fill, fill_opacity=MOD_OPA, width=1.0)

                label = mod.get("model","")
                fs = max(4.5, min(8.0, mh*0.52))
                page.insert_textbox(
                    fitz.Rect(x0m+0.5,y0m+0.5,x1m-0.5,y1m-0.5),
                    label, fontsize=fs, color=(1,1,1), align=1
                )

        # Maßstabsbalken + Legende
        self._draw_scale_bar(page, OUT_W, OUT_H, sx, MARGIN)
        self._draw_legend(page, floor, mod_dims, OUT_W, OUT_H)

        mat = fitz.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        return io.BytesIO(pix.tobytes("png"))

    def _draw_scale_bar(self, page, ow, oh, sx, mg):
        try:
            import fitz
            bl=100*sx; bx=mg; by=oh-mg/2
            page.draw_rect(fitz.Rect(bx-2,by-8,bx+bl+2,by+5),
                          fill=(1,1,1), fill_opacity=0.8, width=0)
            page.draw_line(fitz.Point(bx,by), fitz.Point(bx+bl,by),
                          color=(0.1,0.1,0.1), width=1.5)
            for px in [bx,bx+bl]:
                page.draw_line(fitz.Point(px,by-3),fitz.Point(px,by+3),
                               color=(0.1,0.1,0.1),width=1.0)
            page.insert_text((bx+bl/2-10,by-5),"1.00 m",fontsize=7,color=(0.1,0.1,0.1))
        except: pass

    def _draw_legend(self, page, floor, mod_dims, ow, oh):
        try:
            import fitz
            used={}; tot=0
            for r in (floor.get("rooms") or []):
                for m in (r.get("modules") or []):
                    k=m.get("model",""); q=m.get("quantity",1)
                    used[k]=used.get(k,0)+q; tot+=m.get("power_w",0)*q
            if not used: return
            n=len(used)+2; lh=n*10+12; lw=120.0
            lx=ow-lw-4; ly=4.0
            page.draw_rect(fitz.Rect(lx,ly,lx+lw,ly+lh),
                          color=(0.4,0.4,0.4),fill=(0.97,0.97,0.97),
                          fill_opacity=0.95,width=0.5)
            y=ly+9
            page.insert_text((lx+3,y),"Modullegende",fontsize=6,color=(0.1,0.1,0.4)); y+=10
            for model,qty in sorted(used.items()):
                mi=mod_dims.get(model); pw=mi["power_w"] if mi else 0
                page.draw_rect(fitz.Rect(lx+3,y-5.5,lx+14,y+1.5),
                               color=C_MOD_B,fill=C_MOD,fill_opacity=0.85)
                page.insert_text((lx+16,y),f"{model} x{qty} ({pw}W)",
                                fontsize=5.5,color=C_TEXT); y+=10
            page.draw_line(fitz.Point(lx+3,y),fitz.Point(lx+lw-3,y),
                          color=(0.7,0.7,0.7),width=0.3)
            page.insert_text((lx+3,y+5),f"Gesamt: {tot} W",fontsize=5.5,color=(0.2,0.2,0.2))
        except: pass

    # ── Separates PDF ─────────────────────────────────────────────
    def create_annotated_plan(self, project, output_path):
        try:
            import fitz
        except ImportError:
            raise ImportError("PyMuPDF nicht installiert.")
        rd=fitz.open()
        for floor in project.get("floors",[]):
            png=self._render_plan(floor)
            if png:
                try:
                    img=fitz.open(stream=png.getvalue(),filetype="png")
                    rd.insert_pdf(img)
                except Exception as e:
                    p=rd.new_page(width=595,height=842)
                    p.insert_text((50,400),str(e),fontsize=10)
            else:
                p=rd.new_page(width=595,height=842)
                p.insert_text((50,200),f"Kein Plan - {floor.get('floor_name','')}",fontsize=12)
        if not len(rd): raise ValueError("Keine Seiten.")
        rd.save(output_path)

    # ── Tabellen ──────────────────────────────────────────────────
    def _add_module_cost_table(self, doc, project):
        from docx.shared import Pt, Cm, RGBColor
        doc.add_paragraph().add_run("Moduluebersicht").bold = True
        cw=[Cm(3),Cm(2.5),Cm(2),Cm(2.5),Cm(2.5),Cm(1.5),Cm(2.5)]
        hd=["Raum","Geschoss","Modul","Masse cm","W gesamt","Anz.","Kosten EUR"]
        t=doc.add_table(rows=1,cols=7); t.style="Table Grid"
        for i,h in enumerate(hd):
            c=t.rows[0].cells[i]; c.width=cw[i]
            r=c.paragraphs[0].add_run(h); r.bold=True; r.font.size=Pt(8)
            self._set_cell_bg(c,"1F3A6E"); r.font.color.rgb=RGBColor(255,255,255)
        md={m["model"]:f"{m['width_cm']}x{m['height_cm']}" for m in self.modules}
        tm=0; tp=0; tc=0.0
        for fl in project.get("floors",[]):
            for rm in fl.get("rooms",[]):
                for mod in (rm.get("modules") or []):
                    q=mod.get("quantity",1); co=mod.get("cost_eur",0); pw=mod.get("power_w",0)*q
                    row=t.add_row(); note=" (Eck)" if mod.get("is_corner_module") else ""
                    vs=[rm.get("name","")+note,fl.get("floor_name",""),mod.get("model",""),
                        md.get(mod.get("model",""),"--"),str(pw),str(q),f"{co:.0f}"]
                    for i,v in enumerate(vs):
                        c=row.cells[i]; c.width=cw[i]
                        c.paragraphs[0].add_run(str(v)).font.size=Pt(8)
                    tm+=q; tp+=pw; tc+=co
        sr=t.add_row(); self._set_cell_bg(sr.cells[0],"E8ECF3")
        for i,(txt,bold) in enumerate([(f"Gesamt: {tm} Module",True),("",""),("",""),("",""),
                                       (f"{tp} W",True),("",""),(f"{tc:.0f} EUR",True)]):
            if txt:
                r=sr.cells[i].paragraphs[0].add_run(txt); r.bold=bold; r.font.size=Pt(8)
        for row in t.rows:
            for i,c in enumerate(row.cells): c.width=cw[i]

    def _add_heat_table(self, doc, floor):
        from docx.shared import Pt, Cm, RGBColor
        rooms=floor.get("rooms",[]); 
        if not rooms: return
        cw=[Cm(3),Cm(2),Cm(1.8),Cm(2.5),Cm(2.5),Cm(1.5),Cm(2.4)]
        hd=["Raum","Flaeche m2","W/m2","Heizlast W","Modul","Anz.","Leistung W"]
        t=doc.add_table(rows=1,cols=7); t.style="Table Grid"
        for i,h in enumerate(hd):
            c=t.rows[0].cells[i]; c.width=cw[i]
            r=c.paragraphs[0].add_run(h); r.bold=True; r.font.size=Pt(8)
            self._set_cell_bg(c,"1F3A6E"); r.font.color.rgb=RGBColor(255,255,255)
        th=0.0; tp=0
        for rm in rooms:
            hl=float(rm.get("heat_load_required_w") or 0)
            wm=float(rm.get("heat_load_w_per_m2") or 40)
            ar=float(rm.get("area_m2") or 0)
            mods=rm.get("modules") or []
            mn=", ".join(m.get("model","") for m in mods)
            mq=sum(m.get("quantity",1) for m in mods)
            mp=sum(m.get("power_w",0)*m.get("quantity",1) for m in mods)
            th+=hl; tp+=mp
            row=t.add_row()
            for i,v in enumerate([rm.get("name",""),f"{ar:.2f}",f"{wm:.0f}",
                                   f"{hl:.0f}",mn,str(mq),str(mp)]):
                c=row.cells[i]; c.width=cw[i]
                c.paragraphs[0].add_run(str(v)).font.size=Pt(8)
        sr=t.add_row(); self._set_cell_bg(sr.cells[0],"E8ECF3")
        for ci,txt in [(0,"Gesamt"),(3,f"{th:.0f} W"),(6,f"{tp} W")]:
            r=sr.cells[ci].paragraphs[0].add_run(txt); r.bold=True; r.font.size=Pt(8)
        for row in t.rows:
            for i,c in enumerate(row.cells): c.width=cw[i]

    def _add_cost_summary(self, doc, project):
        from docx.shared import Pt, Cm, RGBColor
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        doc.add_paragraph().add_run("Kostenuebersicht").bold = True
        cpm=float(self.rules.get("cost_per_module_installation",80))
        cpr=float(self.rules.get("cost_electrical_per_room",100))
        tm=0; tr=0; cm=0.0
        for fl in project.get("floors",[]):
            for rm in fl.get("rooms",[]):
                tr+=1
                for mod in (rm.get("modules") or []):
                    tm+=mod.get("quantity",1); cm+=mod.get("cost_eur",0)
        ci=tm*cpm; ce=tr*cpr; net=cm+ci+ce; vat=net*0.19; gross=net+vat
        t=doc.add_table(rows=0,cols=2); t.style="Table Grid"
        for label,value in [
            ("Infrarot-Module (Material)",f"{cm:,.2f} EUR"),
            (f"Montage ({tm} Module x {cpm:.0f} EUR)",f"{ci:,.2f} EUR"),
            (f"Elektroinstallation inkl. Thermostat ({tr} Raeume x {cpr:.0f} EUR)",f"{ce:,.2f} EUR"),
            ("Zwischensumme (netto)",f"{net:,.2f} EUR"),
            ("Umsatzsteuer 19 %",f"{vat:,.2f} EUR"),
            ("GESAMTBETRAG (brutto)",f"{gross:,.2f} EUR"),
        ]:
            row=t.add_row(); row.cells[0].width=Cm(12); row.cells[1].width=Cm(4)
            rl=row.cells[0].paragraphs[0].add_run(label)
            rv=row.cells[1].paragraphs[0].add_run(value)
            row.cells[1].paragraphs[0].alignment=WD_ALIGN_PARAGRAPH.RIGHT
            if label=="GESAMTBETRAG (brutto)":
                for r in [rl,rv]: r.bold=True; r.font.size=Pt(11)
                self._set_cell_bg(row.cells[0],"1F3A6E"); self._set_cell_bg(row.cells[1],"1F3A6E")
                rl.font.color.rgb=RGBColor(255,255,255); rv.font.color.rgb=RGBColor(255,255,255)
            elif "Zwischensumme" in label:
                for r in [rl,rv]: r.bold=True; r.font.size=Pt(10)
            else:
                for r in [rl,rv]: r.font.size=Pt(9)

    # ── Briefkopf ─────────────────────────────────────────────────
    def _add_header(self, doc, project):
        from docx.shared import Pt
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        s=self.settings; h=doc.add_paragraph(); h.alignment=WD_ALIGN_PARAGRAPH.RIGHT
        run=h.add_run(s.get("company_name","")); run.bold=True; run.font.size=Pt(12)
        for line in [s.get("company_address",""),
                     f"{s.get('company_zip','')} {s.get('company_city','')}",
                     f"Tel.: {s.get('company_phone','')}", s.get("company_email","")]:
            if line.strip(): h.add_run(f"\n{line}").font.size=Pt(9)
        self._add_horizontal_line(doc)

    def _add_offer_meta(self, doc, project):
        from docx.shared import Pt
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        now=datetime.now(); vu=now+timedelta(days=int(self.settings.get("offer_validity_days",90)))
        m=doc.add_paragraph(); m.alignment=WD_ALIGN_PARAGRAPH.RIGHT
        m.add_run(f"Angebotsnr.: {project.get('project_number','N/A')}\n"
                  f"Datum: {now.strftime('%d.%m.%Y')}\n"
                  f"Gueltig bis: {vu.strftime('%d.%m.%Y')}").font.size=Pt(9)

    def _add_customer_address(self, doc, project):
        from docx.shared import Pt
        c=project.get("customer",{}); doc.add_paragraph()
        addr=doc.add_paragraph()
        if c.get("company_name"): addr.add_run(f"{c['company_name']}\n").bold=True
        if c.get("contact_name"): addr.add_run(f"z. Hd. {c['contact_name']}\n")
        addr.add_run(f"{c.get('address','')}\n{c.get('zip_code','')} {c.get('city','')}").font.size=Pt(10)

    def _add_footer_notes(self, doc):
        from docx.shared import Pt
        self._add_horizontal_line(doc)
        n=doc.add_paragraph(); n.add_run("Planungshinweise:\n").bold=True
        n.add_run("- Alle Module werden an der Decke montiert.\n"
                  "- Mindestabstaende: Wand >= 50cm, Unterzuege >= 20cm, Leuchten >= 50cm.\n"
                  "- Keine Module ueber Sitz-, Schlaf- oder Arbeitsflaechen.\n"
                  "- Schlafzimmer: Module ueber dem Fussbereich des Bettes.\n"
                  "- Elektroinstallation inkl. Raumthermostat je Heizkreis.\n"
                  "- Preise zzgl. MwSt.\n").font.size=Pt(8)
        if self.settings.get("iban"):
            doc.add_paragraph().add_run(
                f"Bank: {self.settings.get('bank_name','')} | "
                f"IBAN: {self.settings.get('iban','')} | "
                f"BIC: {self.settings.get('bic','')}").font.size=Pt(8)

    # ── Hilfsfunktionen ───────────────────────────────────────────
    def _load_pdf_bytes(self, floor) -> Optional[bytes]:
        if floor.get("pdf_base64"):
            try:
                d=b64mod.b64decode(floor["pdf_base64"])
                if len(d)>100: return d
            except: pass
        pp=floor.get("pdf_path")
        if pp and Path(pp).exists():
            with open(pp,"rb") as f: return f.read()
        ud=Path("/app/uploads"); fn=floor.get("pdf_filename","")
        if ud.exists():
            if fn:
                for f in ud.glob("*"):
                    if fn in f.name or f.name.endswith(fn):
                        with open(str(f),"rb") as fp: return fp.read()
            pdfs=sorted([f for f in ud.glob("*.pdf")],
                       key=lambda x:x.stat().st_mtime, reverse=True)
            if pdfs:
                with open(str(pdfs[0]),"rb") as f: return f.read()
        return None

    def _set_cell_bg(self, cell, hex_color):
        from docx.oxml.ns import qn
        from docx.oxml import OxmlElement
        tc=cell._tc; tcPr=tc.get_or_add_tcPr()
        shd=OxmlElement("w:shd")
        shd.set(qn("w:val"),"clear"); shd.set(qn("w:color"),"auto")
        shd.set(qn("w:fill"),hex_color); tcPr.append(shd)

    def _add_horizontal_line(self, doc):
        from docx.oxml.ns import qn
        from docx.oxml import OxmlElement
        p=doc.add_paragraph(); pPr=p._p.get_or_add_pPr()
        pBdr=OxmlElement("w:pBdr"); bottom=OxmlElement("w:bottom")
        bottom.set(qn("w:val"),"single"); bottom.set(qn("w:sz"),"6")
        bottom.set(qn("w:space"),"1"); bottom.set(qn("w:color"),"1F3A6E")
        pBdr.append(bottom); pPr.append(pBdr)
