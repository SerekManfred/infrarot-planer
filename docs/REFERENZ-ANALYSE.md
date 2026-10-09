# Referenz-Analyse: Altprojekt „infrarot-planer-new“

Quelle: `~/infrarot-referenz.tar.gz`, entpackt nach `referenz/infrarot-planer-new/` (Dateistand 13.–15.04.2026, API-Version 1.3.0 bzw. Health-Endpunkt 1.3.2). Das Archiv enthielt keine `.env` und keine hart codierten API-Schlüssel.

## 1. Überblick

| Bereich | Umsetzung im Altprojekt |
|---|---|
| Backend | FastAPI 0.115, Python 3.11, ein Container `infrarot-backend` |
| Frontend | statisches HTML + Vanilla-JS (`index.html`, `app.js`, ~1100 Zeilen), ausgeliefert über nginx im Container `infrarot-frontend` |
| Speicherung | JSON-Dateien im Volume (`/app/data/projects/*.json`, `settings.json`, `rules.json`, `modules.json`) – keine Datenbank |
| Offline/PWA | nicht vorhanden (kein Service Worker, kein IndexedDB, keine Offline-Speicherung) |
| Heizlast | pauschal Fläche × W/m² (Standard 40 W/m², Bad 80 W/m²) – **keine** Bauteile, keine U-Werte, kein DIN-EN-12831-Ansatz |
| Ausgabe | Word-Angebot (.docx) und Grundriss-PDF mit eingezeichneten Modulen |
| Tests | keine |
| Ports | Frontend veröffentlicht `8000:80` direkt auf dem Host |

Ablauf in der Oberfläche: Projekt anlegen → PDF-Grundriss je Geschoss hochladen → KI-Analyse → Raumliste korrigieren (Tabelle, kein grafischer Editor) → Module planen → Angebot/Plan-PDF erzeugen.

## 2. KI-Dienst und Modell

- **Dienst:** Anthropic Claude, Messages API (`https://api.anthropic.com/v1/messages`), direkt per `httpx` angesprochen, nicht über das offizielle SDK.
- **Modell:** `claude-opus-4-5` (Konstante `CLAUDE_MODEL` in `backend/pdf_analyzer.py`).
- **Header:** `anthropic-version: 2023-06-01`, zusätzlich der veraltete Beta-Header `anthropic-beta: pdfs-2024-09-25` (PDF-Unterstützung ist inzwischen allgemein verfügbar).
- **Eingabe:** das komplette PDF als Base64-`document`-Block plus Textprompt, `max_tokens: 4096`, Timeout 120 s.
- **Ausgabe:** Freitext, aus dem per Regex ein JSON-Block herausgesucht wird (`_parse_json`). Kein Structured Output / Tool-Use, keine Schema-Validierung.
- **API-Schlüssel:** aus `ANTHROPIC_API_KEY` oder – unsicher – aus `/app/data/api_key.txt`, der über die Einstellungsseite der Oberfläche im Klartext gespeichert wird.

## 3. Vollständiger Prompt zur Planerkennung

Wörtlich aus `backend/pdf_analyzer.py` (`ANALYSIS_PROMPT`). An den Prompt wird angehängt: `\n\nGeschossname: {floor_name}`.

```text
Du bist Experte fuer Bauplananalyse. Lies ALLE Massangaben aus diesem Grundriss aus.

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
}
```

### Bewertung des Prompts

- **Gut:** klare Schrittfolge, eindeutiger Koordinatenursprung (Innenkante Außenwand oben links), Ausgabe in cm statt Pixel, Bad als eigener Raumtyp, `warnings`-Feld.
- **Schwächen:**
  - Nur rechteckige Räume und ein rechteckiger Baukörper (eine Bounding-Box); L-Grundrisse, Erker, Dachschrägen nicht abbildbar.
  - Fenster und Türen werden **nicht** erfasst – für eine Heizlast nach DIN EN 12831-1 aber zwingend nötig (Flächen, Orientierung).
  - Keine Raumhöhe, keine Geschosshöhe, keine Himmelsrichtung/Nordpfeil, keine Unterscheidung Außen-/Innenwand je Raumseite.
  - Vermischt Erkennung (Geometrie) mit Planung (Modulpositionen, „nicht über Sofa“) – die Planung gehört in den Rechenkern, nicht ins Modell.
  - Kein Konfidenzwert je Maß, keine Kennzeichnung „gelesen“ vs. „geschätzt“.
  - Nur ASCII-Umlaute, Platzhalter im Beispiel-JSON sind kein gültiges JSON → Parsing per Regex nötig.
  - Nur erste PDF-Seite wird später für den Hintergrund genutzt; keine Unterstützung für Fotos/Scans als Bild.

## 4. Aufbau der „Word-Vorlage“

Es gibt **keine** .docx-/.dotx-Vorlagendatei. Das Angebot wird in `backend/document_generator.py` mit `python-docx` aus einem leeren Dokument programmatisch aufgebaut. Ein CI ist nicht umgesetzt (Standardschrift, keine Logos, keine Formatvorlagen).

Aufbau des Dokuments „Angebot – Infrarot-Heizungsanlage“:

1. **Seitenränder:** oben/unten 2 cm, links/rechts 2,5 cm.
2. **Briefkopf** (rechtsbündig): Firmenname fett 12 pt, Adresse, PLZ/Ort, Telefon, E-Mail in 9 pt; darunter Trennlinie (Absatzrahmen, Farbe `#1F3A6E`).
3. **Angebotsdaten** (rechtsbündig, 9 pt): Angebotsnr. (= Projektnummer), Datum, „Gültig bis“ (+ `offer_validity_days`, Standard 90).
4. **Kundenanschrift:** Firma (fett), „z. Hd.“ Ansprechpartner, Straße, PLZ Ort.
5. **Betreff:** „Angebot - Infrarot-Heizungsanlage“ (fett), „Bauvorhaben: …“.
6. **Tabelle Modulübersicht** (7 Spalten: Raum, Geschoss, Modul, Maße cm, W gesamt, Anz., Kosten EUR); Kopfzeile weiß auf `#1F3A6E`, 8 pt, Summenzeile hellgrau `#E8ECF3`.
7. **Kostenübersicht** (2 Spalten): Material, Montage (Module × Pauschale), Elektroinstallation (Räume × Pauschale), Zwischensumme netto, USt 19 %, Gesamtbetrag brutto (weiß auf `#1F3A6E`).
8. **Je Geschoss:** Überschrift „Grundrissplan – …“, gerendertes PNG (16 cm breit, mit PyMuPDF gezeichnet: Außenwand, Innenwände, Räume eingefärbt, Module orange/Eckfenstermodul blau, Maßstabsbalken 1 m, Modullegende, optional Original-PDF aufgehellt im Hintergrund), danach Tabelle „Heizlastberechnung“ (Raum, Fläche, W/m², Heizlast, Modul, Anz., Leistung).
9. **Fußbereich:** Trennlinie, „Planungshinweise“ (Deckenmontage, Mindestabstände Wand 50 cm / Unterzug 20 cm / Leuchte 50 cm, nicht über Sitz-/Schlaf-/Arbeitsflächen, Schlafzimmer über Fußbereich, Thermostat je Heizkreis, Preise zzgl. MwSt.), optional Bankverbindung.

Es handelt sich also um ein **Handwerker-Angebot**, nicht um einen Energieberatungsbericht.

## 5. Weitere Auffälligkeiten (Fehler/Risiken)

- **Doppelte Kosten bei 2-Modul-Räumen:** `_select_modules` setzt `cost_eur = Preis × 2` bei `quantity = 2`, `_plan_room` multipliziert danach nochmals mit `quantity` → Materialkosten vierfach statt doppelt.
- **`_consolidate_modules`** addiert `power_w` und `cost_eur` auf, obwohl diese als Stückwerte weiter mit `quantity` multipliziert werden → Leistung/Kosten zu hoch.
- **Datenleck im Plan-Renderer:** `_load_pdf_bytes` nimmt als Rückfall *irgendeine* zuletzt hochgeladene PDF aus `/app/uploads` – ggf. den Grundriss eines anderen Kunden.
- Upload-Dateiname wird ungeprüft in den Pfad übernommen (`plan_{floor_name}_{file.filename}`) → Pfadmanipulation möglich.
- Keine Anmeldung/Benutzerverwaltung, CORS `*`, Port 8000 offen am Host.
- API-Schlüssel per Web-Formular im Klartext auf Platte.
- Heizlast ohne Bauphysik; „Eckfenster-Modul“ fest auf Modell ST-680 verdrahtet.
- Doppelte Schlüssel im Ergebnis-Dict (`planner.py`), uneinheitliche Versionsnummern.

## 6. Was taugt für den Neubau?

**Übernehmen (als Idee, neu und sauber umgesetzt):**

- Grundprinzip KI-Import: PDF direkt an Claude, Ausgabe in **cm ab definiertem Ursprung** statt Pixel. Den Koordinaten-Ansatz (Innenkante Außenwand oben links) beibehalten.
- Rückrechnung fehlender Felder (Fläche aus Breite × Tiefe) und `warnings`-Liste – im Neubau als Plausibilitätsprüfung im Backend.
- Darstellungsidee für den Korrektur-Editor und Plan-Export: Original-Grundriss aufgehellt im Hintergrund, erkannte Geometrie darüber.
- Planungsregeln für die spätere Paneelauslegung (Mindestabstände, Bad/Schlafzimmer/Wohnzimmer-Regeln, Modulkatalog mit Maßen/Leistung/Preis) als **Startdaten** – Regeln konfigurierbar, aber im Rechenkern statt im Prompt.
- Tabellenaufbau (Raumliste, Heizlast je Raum) und Farbgebung `#1F3A6E` als Ausgangspunkt, bis das CI festgelegt ist.

**Neu machen:**

- KI-Aufruf über das offizielle `anthropic`-SDK mit aktuellem Modell, strukturierter Ausgabe (Tool-Use/JSON-Schema) und Pydantic-Validierung statt Regex.
- Prompt nur für **Erkennung**: Polygone statt Rechtecke, Fenster/Türen mit Maßen und Lage, Raumhöhe, Nordpfeil, Wandart je Raumseite, Konfidenz je Wert. Keine Planung im Prompt.
- Heizlast vollständig neu im `rechenkern/` (Transmission über Bauteile/U-Werte + Lüftung, Norm-Außentemperatur, Raumsolltemperaturen) mit Tests.
- PostgreSQL statt JSON-Dateien, PWA mit IndexedDB statt Online-Zwang.
- Word-Bericht später mit echter CI-Vorlage (.dotx) statt programmatisch zusammengebautem Dokument.
- Sicherheit: API-Schlüssel nur über `.env`, Anmeldung, keine offenen Ports (Zugang über Caddy), sichere Dateinamen, Uploads je Projekt getrennt.

**Nicht übernehmen:** `planner.py` (pauschale W/m²-Heizlast, Rechenfehler), `document_generator.py` als Code, `app.js`/`index.html` (keine PWA, nicht offline-fähig), Speicherung des API-Schlüssels über die Oberfläche.
