# frontend

React-18-PWA (Vite, vite-plugin-pwa), ausgelegt auf Tablet-Bedienung vor Ort. Oberfläche auf Deutsch.

Stand Phase 1B:

- Anmeldung, Konto (Passwort ändern), Benutzerverwaltung (Admin)
- Projektliste mit Status; neues Projekt mit Pflichtfeld Gebäudestandard
- Projektansicht: Status prüfen/freigeben (Fachprüfer), Sperre nach Freigabe
- **Schnellerfassung:** Geschoss-Knöpfe (KG/EG/OG/DG), Räume als Rechteck (Länge × Breite, Höhe, Raumtyp), Fläche und Heizlast sofort; Heizlastquelle A/B/C; Gegenprobe C mit Abweichung
- Bauteilmasken (Flächen, Fenster/Türen) nur aufklappbar für Quelle C
- Projektvorgaben (Abweichungen, Klimadaten), Änderungsprotokoll
- Fachvorgaben-Pflege mit Pauschalen-Matrix, Raumtypen, CSV-Import und Protokoll
- Herkunft jedes Werts sichtbar (Vorgabe, Rückfallwert, Projektwert, Raumwert, „Vorgabe fehlt“); Abweichungen orange hervorgehoben

Eingaben werden beim Verlassen des Felds gespeichert (Komma oder Punkt als Dezimaltrenner). Service Worker und Manifest sind aktiv (App installierbar). **Noch keine Offline-Speicherung von Daten** – IndexedDB folgt.

Der Rechenkern wird über den Alias `@infrarot/rechenkern` direkt aus `../rechenkern/src` eingebunden.

## Bauen

Auf dem Server ist kein Node installiert; gebaut wird im Container (`frontend/Dockerfile`, Build-Kontext ist das Projektverzeichnis). Lokal zum Ausprobieren:

```bash
docker run --rm --name infrarot-npm-frontend --user "$(id -u):$(id -g)" -e npm_config_cache=/tmp/npm \
  -v "$PWD":/arbeit -w /arbeit/frontend node:22.14.0-bookworm-slim sh -c "npm ci && npm run build"
```

Ausgeliefert wird `dist/` über nginx (`nginx.conf`), das `/api/` an `infrarot-backend:8000` weiterreicht.

Die App-Icons (`public/icon-*.png`, `icon.svg`) sind Platzhalter bis zur Festlegung des CI.
