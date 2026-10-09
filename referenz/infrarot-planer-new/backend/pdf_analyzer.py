"""
PDF Bauplan Analyse v1.3.1
KI liest alle Maßketten aus und gibt:
- Exakte Raumkoordinaten (x_cm, y_cm, x1_cm, y1_cm)
- Alle Innenwände als Liste
- Modulpositionen nach Planungsregeln
"""
import base64, httpx, json, logging, re
from typing import Optional
logger = logging.getLogger(__name__)
CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL = "claude-opus-4-5"

ANALYSIS_PROMPT = """Du bist Experte fuer Bauplananalyse. Lies ALLE Massangaben aus diesem Grundriss aus.

SCHRITT 1 - AUSSENMASSE:
Lies die Gesamtabmessungen des Gebaeudes aus den Bemassketten.
- house_width_cm, house_height_cm (Aussenmass)
- wall_thickness_cm (Aussenwandstaerke, typisch 25-36cm)
- inner_wall_cm (Innenwandstaerke, typisch 10-18cm)

SCHRITT 2 - BAUKÖRPER-POSITION auf der Seite:
- house_x0_percent, house_y0_percent: obere linke Ecke Aussenwand (% der Seitenbreite/-hoehe)
- house_x1_percent, house_y1_percent: untere rechte Ecke Aussenwand

SCHRITT 3 - RAUMKOORDINATEN aus Massangaben:
Koordinatenursprung = obere linke INNENKANTE der Aussenwand.
Fuer jeden Raum:
- x_cm: linke Innenkante vom Ursprung
- y_cm: obere Innenkante vom Ursprung
- x1_cm: rechte Innenkante (= x_cm + Raumbreite)
- y1_cm: untere Innenkante (= y_cm + Raumtiefe)
- width_cm = x1_cm - x_cm
- height_cm = y1_cm - y_cm

SCHRITT 4 - INNENWÄNDE:
Liste ALLER Innenwände als Rechtecke:
- x0_cm, y0_cm: obere linke Ecke der Wand (vom Ursprung)
- x1_cm, y1_cm: untere rechte Ecke
- thickness_cm: Wandstaerke

SCHRITT 5 - MODULPOSITIONEN:
Fuer jeden Raum: optimale Modulposition in cm vom Ursprung.
Regeln:
- Mindestabstand Wand: 50cm
- Wohnzimmer (>=15m2): 2 Module symmetrisch, NICHT ueber Sofa/Sitzgruppe
- Schlafzimmer: Modul ueber Fussbereich des Bettes (Y = y_cm + height_cm*0.65)
- Bad/WC: Deckenmitte
- Alle anderen: Deckenmitte

Antworte NUR mit diesem JSON:
{
  "floor_name": "Geschoss",
  "scale": "1:100",
  "house_width_cm": Gesamtbreite,
  "house_height_cm": Gesamttiefe,
  "wall_thickness_cm": Aussenwandstaerke,
  "inner_wall_cm": Innenwandstaerke,
  "house_x0_percent": linke Aussenwand % der Seitenbreite,
  "house_y0_percent": obere Aussenwand % der Seitenhoehe,
  "house_x1_percent": rechte Aussenwand % der Seitenbreite,
  "house_y1_percent": untere Aussenwand % der Seitenhoehe,
  "inner_walls": [
    {"x0": cm, "y0": cm, "x1": cm, "y1": cm, "thickness": cm, "name": "Wand-Bezeichnung"}
  ],
  "rooms": [
    {
      "room_id": "R001",
      "name": "Raumname",
      "room_type": "standard oder bathroom",
      "x_cm": linke Innenkante,
      "y_cm": obere Innenkante,
      "x1_cm": rechte Innenkante,
      "y1_cm": untere Innenkante,
      "width_cm": Breite,
      "height_cm": Tiefe,
      "area_m2": Flaeche,
      "module_x_cm": Modulposition X,
      "module_y_cm": Modulposition Y,
      "module_x2_cm": zweite Modulposition X (nur bei >=15m2),
      "module_y2_cm": zweite Modulposition Y (nur bei >=15m2),
      "placement_reason": "Begruendung",
      "has_corner_window": false
    }
  ],
  "warnings": []
}"""


class PDFAnalyzer:
    def __init__(self):
        import os
        self.api_key = os.environ.get("ANTHROPIC_API_KEY","")
        if not self.api_key:
            kf="/app/data/api_key.txt"
            if __import__('os').path.exists(kf):
                with open(kf) as f: self.api_key=f.read().strip()

    async def analyze(self, pdf_bytes: bytes, floor_name: str = "Erdgeschoss") -> dict:
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY nicht gesetzt.")
        pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")
        headers = {"x-api-key":self.api_key, "anthropic-version":"2023-06-01",
                   "content-type":"application/json", "anthropic-beta":"pdfs-2024-09-25"}
        payload = {"model":CLAUDE_MODEL, "max_tokens":4096, "messages":[{"role":"user","content":[
            {"type":"document","source":{"type":"base64","media_type":"application/pdf","data":pdf_b64}},
            {"type":"text","text":ANALYSIS_PROMPT+f"\n\nGeschossname: {floor_name}"}
        ]}]}
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(CLAUDE_API_URL, headers=headers, json=payload)
        if response.status_code != 200:
            raise ValueError(f"Claude API Fehler {response.status_code}: {response.text}")
        result = self._parse_json(response.json()["content"][0]["text"])

        # Fehlende Felder ergaenzen
        hw = float(result.get("house_width_cm") or 1000)
        hh = float(result.get("house_height_cm") or 1000)
        for room in result.get("rooms",[]):
            xc=float(room.get("x_cm") or 0); yc=float(room.get("y_cm") or 0)
            wc=float(room.get("width_cm") or 0); hc=float(room.get("height_cm") or 0)
            # x1_cm/y1_cm berechnen falls nicht vorhanden
            if not room.get("x1_cm"): room["x1_cm"] = xc+wc
            if not room.get("y1_cm"): room["y1_cm"] = yc+hc
            if not room.get("area_m2"): room["area_m2"] = round(wc*hc/10000,2)
            # Kompatibilitaet
            room["x_pos_percent"] = round((xc+wc/2)/hw*100,1)
            room["y_pos_percent"] = round((yc+hc/2)/hh*100,1)

        result.update({"pdf_base64":pdf_b64, "floor_name":floor_name,
                       "house_width_cm":hw, "house_height_cm":hh})
        return result

    def _parse_json(self, text):
        try: return json.loads(text.strip())
        except: pass
        for p in [r'```json\s*([\s\S]*?)\s*```',r'```\s*([\s\S]*?)\s*```',r'(\{[\s\S]*\})']:
            m=re.search(p,text)
            if m:
                try: return json.loads(m.group(1))
                except: continue
        raise ValueError(f"Kein JSON: {text[:300]}")
