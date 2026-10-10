# frontend

React-18-PWA (Vite, vite-plugin-pwa), ausgelegt auf Tablet-Bedienung vor Ort. Oberfläche auf Deutsch.

Stand Phase 1C:

- Anmeldung, Konto (Passwort ändern), Benutzerverwaltung (Admin)
- Projektliste mit Status; neues Projekt mit Pflichtfeld Gebäudestandard
- Projektansicht: Status prüfen/freigeben (Fachprüfer), Sperre nach Freigabe
- **Schnellerfassung:** Geschoss-Knöpfe (KG/EG/OG/DG), Räume als Rechteck (Länge × Breite, Höhe, Raumtyp), Fläche und Heizlast sofort; Heizlastquelle A/B/C; Gegenprobe C mit Abweichung
- Bauteilmasken (Flächen, Fenster/Türen) nur aufklappbar für Quelle C
- Projektvorgaben (Abweichungen, Klimadaten), Änderungsprotokoll
- Fachvorgaben-Pflege mit Pauschalen-Matrix, Raumtypen, CSV-Import und Protokoll
- Herkunft jedes Werts sichtbar (Vorgabe, Rückfallwert, Projektwert, Raumwert, „Vorgabe fehlt“); Abweichungen orange hervorgehoben

- **Offline-Betrieb:**
  - Projekt auschecken und lokal bearbeiten, auch ohne Netz.
  - Warteschlange mit automatischer Übertragung; Statusanzeige im Kopf.
  - Einchecken; die Sperre anderer Geräte wird angezeigt, ein Admin kann sie lösen.

Eingaben werden beim Verlassen des Felds gespeichert (Komma oder Punkt als Dezimaltrenner). Service Worker und Manifest sind aktiv: Die App ist installierbar und startet ohne Netz.

## Offline-Schicht (`src/offline/`)

| Datei | Aufgabe |
|---|---|
| `lokal.ts` | reine Logik: API-Anfragen auf dem lokalen Projektstand ausführen, vorläufige IDs, Rechenkern-Eingabe aus dem Schnappschuss |
| `speicher.ts` | IndexedDB (`infrarot-planer`: werte, projekte, warteschlange); Variante im Arbeitsspeicher für Tests |
| `dienst.ts` | Weiche lokal/Server, Ersatzantworten ohne Netz, Auschecken/Einchecken, Warteschlange und Synchronisierung |
| `daten.ts` | die eine Instanz der App, Hook `useOffline()` für die Statusanzeige |

Die Komponenten rufen weiter `api.get/post/patch/…` auf (`src/api.ts`). Ob die Antwort vom Server oder aus dem Offline-Speicher kommt, entscheidet der Dienst. Der Netzzugriff selbst liegt in `src/netz.ts` (20 s Zeitlimit, danach gilt die Anfrage als offline).

Der Rechenkern wird über den Alias `@infrarot/rechenkern` direkt aus `../rechenkern/src` eingebunden.

## Bauen

Auf dem Server ist kein Node installiert; gebaut wird im Container (`frontend/Dockerfile`, Build-Kontext ist das Projektverzeichnis). Lokal zum Ausprobieren:

```bash
docker run --rm --name infrarot-npm-frontend --user "$(id -u):$(id -g)" -e npm_config_cache=/tmp/npm \
  -v "$PWD":/arbeit -w /arbeit/frontend node:22.14.0-bookworm-slim sh -c "npm ci && npm test && npm run build"
```

Ausgeliefert wird `dist/` über nginx (`nginx.conf`), das `/api/` an `infrarot-backend:8000` weiterreicht.

Die App-Icons (`public/icon-*.png`, `icon.svg`) sind Platzhalter bis zur Festlegung des CI.
