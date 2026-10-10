# CLAUDE.md – Infrarot-Planer

## Zweck

Web-App (PWA) vor allem für den **Außendienst der Mein Energie Haus GmbH (MEH)**: Vor-Ort-Planung von **Infrarot-Deckenmodulen** (ausschließlich Deckenmontage), daraus Angebot und Platzierungsplan.
Die **Energieberatung Serek** pflegt die Fachvorgaben und prüft die Ergebnisse fachlich.

Ablauf:

1. Projekt anlegen, Gebäudestandard wählen (Pflicht)
2. Schnellerfassung vor Ort am Tablet: Geschoss → Räume als Rechteck (Länge, Breite, Höhe, Raumtyp)
3. Raumheizlast aus der gewählten Heizlastquelle (A Pauschal / B Hottgenroth / C vereinfachte Berechnung als Gegenprobe)
4. Fachliche Prüfung und Freigabe durch Serek
5. Später: Modulkatalog, Sperrflächen, Platzierung, Angebot, Platzierungsplan, Grundriss-Import per KI, Offline-Speicher

Fachregeln im Detail: `docs/FACHKONZEPT.md`.

## Rollen und Status

- **Außendienst MEH** (`aussendienst`): erfasst Projekte vor Ort.
- **Fachprüfer Serek** (`fachpruefer`): pflegt Fachvorgaben, prüft und gibt frei.
- **Admin** (`admin`): Benutzerverwaltung, Fachvorgaben, Betrieb. Prüft und gibt **nicht** frei.
- Projektstatus: **Vor-Ort-Entwurf → fachlich geprüft → freigegeben**. Nur Fachprüfer ändern den Status.
- Alle sehen alle Projekte. Jede Änderung wird mit Benutzer und Zeit protokolliert.

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic
- **Datenbank:** PostgreSQL 16, eigene Datenbank in eigenem Container (`infrarot-db`)
- **Frontend:** React + Vite als PWA, tabletfreundlich; Offline-Speicher in IndexedDB folgt
- **Rechenkern:** TypeScript-Modul ohne Web-/DB-Abhängigkeiten, läuft im Browser und auf dem Server (Node-CLI), Tests mit Vitest
- **Fachwerte:** Werden zentral gepflegt (Fachvorgaben) bzw. per CSV mit Quellenangabe importiert. **Nie Fachwerte erfinden** – fehlende Werte werden als „Vorgabe fehlt“ gekennzeichnet. Testwerte sind als „TESTWERT“ gekennzeichnete Fantasiewerte.
- **Betrieb:** Docker Compose (Projektname `infrarot`); Ports nur an 127.0.0.1; HTTPS später über den bereits laufenden Caddy-Container; tägliche Datensicherung (`docs/BACKUP.md`)
- **Node/npm** sind auf dem Server nicht installiert: Builds und Tests laufen in Containern (Befehle in den READMEs)

## Ordnerstruktur

```
backend/     FastAPI-Anwendung (API, Datenbank, Fachvorgaben, Protokoll, später KI-Import und Exporte)
frontend/    PWA (Oberfläche, Service Worker, später IndexedDB)
rechenkern/  Heizlast (Pauschal, vereinfachte Berechnung, Gegenprobe), später Modulauslegung – TypeScript, getestet
betrieb/     Betriebsskripte (Datensicherung)
docs/        STATUS.md (Stand), FACHKONZEPT.md, CSV-FORMATE.md, BACKUP.md, Analysen
referenz/    Altprojekt als Nachschlagewerk – nur lesen, nicht weiterentwickeln
```

## Arbeitsregeln

- **Kleine Schritte:** jede Änderung überschaubar halten, nach jedem Schritt lauffähiger Stand und eigener Commit.
- **Tests für den Rechenkern:** jede Rechenfunktion bekommt Tests mit nachvollziehbaren Beispielwerten. Keine Änderung am Rechenkern ohne grüne Tests.
- **Keine Geheimnisse im Code:** API-Schlüssel, Passwörter usw. nur über Umgebungsvariablen bzw. `.env` (steht in `.gitignore`). Eine `.env.example` ohne echte Werte dokumentiert die Variablen.
- **Deutsch:** Kommentare, Oberfläche, Meldungen und Dokumentation auf Deutsch. Bezeichner im Code dürfen englisch sein, aber einheitlich.
- **Tablet zuerst:** große Bedienelemente (mind. 44 px), wenig Tipparbeit, Detailmasken nur wo nötig.
- `referenz/` wird nicht verändert; Brauchbares wird neu und sauber übernommen, nicht kopiert.
- Nichts starten und keine Ports öffnen, ohne dass es für die jeweilige Phase ausdrücklich vorgesehen ist.

## Stand

Aktueller Stand, Startbefehle und offene Punkte: `docs/STATUS.md`.

## Feste Regel: Server-Nachbarn nicht anfassen

**Container, Volumes, Netzwerke und Dateien der Schulungsplattform (alles mit „schulung“ im Namen) sowie den Caddy-Container niemals verändern, stoppen oder löschen.**

**Docker-Befehle nur für Container mit dem Präfix „infrarot“.** Das gilt auch für Volumes und Netzwerke dieses Projekts (Präfix `infrarot`). Keine globalen Befehle wie `docker system prune`, `docker volume prune`, `docker network prune` oder `docker compose down` ohne Projektbezug.
