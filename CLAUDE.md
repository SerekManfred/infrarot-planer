# CLAUDE.md – Infrarot-Planer

## Projektziel

Web-App für die eigenen Energieberater zur Planung von Infrarotheizungen:

1. Projekt anlegen
2. Vor-Ort-Erfassung am Tablet (offline-fähig, PWA)
3. Grundriss-Import per KI mit Korrektur-Editor
4. Bauteile und U-Werte erfassen
5. Raumweise Heizlast (vereinfachtes Verfahren nach dem Prinzip der DIN EN 12831-1)
6. Raumliste als PDF/Excel

Später: Paneelauslegung, Variantenvergleich Infrarot/Wärmepumpe, Word-Bericht im CI.

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic
- **Datenbank:** PostgreSQL 16, eigene Datenbank in eigenem Container (`infrarot-db`)
- **Frontend:** React + Vite als PWA, offline-fähige Speicherung in IndexedDB (folgt), Abgleich mit dem Backend
- **Rechenkern:** TypeScript-Modul ohne Web-/DB-Abhängigkeiten, läuft im Browser und auf dem Server (Node-CLI), Tests mit Vitest
- **Normgrundlagen:** Normaußentemperatur nach DIN/TS 12831-1; Pauschal-U-Werte nach der amtlichen Bekanntmachung für den Wohngebäudebestand. Beides nur per CSV-Import mit Quellenangabe – **nie Werte erfinden**. Testwerte sind als „TESTWERT“ gekennzeichnete Fantasiewerte.
- **Betrieb:** Docker Compose (Projektname `infrarot`); Ports nur an 127.0.0.1; HTTPS später über den bereits laufenden Caddy-Container
- **Node/npm** sind auf dem Server nicht installiert: Builds und Tests laufen in Containern (Befehle in den READMEs)

## Ordnerstruktur

```
backend/     FastAPI-Anwendung (API, Datenbankzugriff, KI-Anbindung, Exporte)
frontend/    PWA (Oberfläche, Service Worker, IndexedDB)
rechenkern/  Heizlast- und Auslegungsberechnung (TypeScript), eigenständig und getestet
docs/        Projektdokumentation: STATUS.md (Stand), CSV-FORMATE.md, Analysen
referenz/    Altprojekt als Nachschlagewerk – nur lesen, nicht weiterentwickeln
```

## Arbeitsregeln

- **Kleine Schritte:** jede Änderung überschaubar halten, nach jedem Schritt lauffähiger Stand und eigener Commit.
- **Tests für den Rechenkern:** jede Rechenfunktion bekommt Tests mit nachvollziehbaren Beispielwerten. Keine Änderung am Rechenkern ohne grüne Tests.
- **Keine Geheimnisse im Code:** API-Schlüssel, Passwörter usw. nur über Umgebungsvariablen bzw. `.env` (steht in `.gitignore`). Eine `.env.example` ohne echte Werte dokumentiert die Variablen.
- **Deutsch:** Kommentare, Oberfläche, Meldungen und Dokumentation auf Deutsch. Bezeichner im Code dürfen englisch sein, aber einheitlich.
- `referenz/` wird nicht verändert; Brauchbares wird neu und sauber übernommen, nicht kopiert.
- Nichts starten und keine Ports öffnen, ohne dass es für die jeweilige Phase ausdrücklich vorgesehen ist.

## Stand

Aktueller Stand, Startbefehle und offene Punkte: `docs/STATUS.md`.

## Feste Regel: Server-Nachbarn nicht anfassen

**Container, Volumes, Netzwerke und Dateien der Schulungsplattform (alles mit „schulung“ im Namen) sowie den Caddy-Container niemals verändern, stoppen oder löschen.**

**Docker-Befehle nur für Container mit dem Präfix „infrarot“.** Das gilt auch für Volumes und Netzwerke dieses Projekts (Präfix `infrarot`). Keine globalen Befehle wie `docker system prune`, `docker volume prune`, `docker network prune` oder `docker compose down` ohne Projektbezug.
