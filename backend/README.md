# backend

FastAPI-Anwendung mit SQLAlchemy 2 und Alembic auf PostgreSQL 16. Die Heizlast rechnet nicht Python, sondern der TypeScript-Rechenkern (`rechenkern/dist/cli.cjs`), der im Image mit Node aufgerufen wird. So ist das Ergebnis im Browser und auf dem Server identisch.

## Aufbau

```
app/main.py               App, Fehlerbehandlung, Router
app/models.py             Datenmodell (Benutzer, Projekt → Objekt → Geschoss → Raum → Bauteilfläche → Öffnung,
                          Bibliotheken, versionierte Berechnungen)
app/schemas.py            API-Schemas
app/sicherheit.py         Argon2id-Passwörter, JWT im HttpOnly-Cookie
app/csv_import.py         CSV-Import der Bibliotheken (Format: docs/CSV-FORMATE.md)
app/berechnung.py         stellt die Rechenkern-Eingabe aus der Datenbank zusammen, meldet fehlende Kennwerte
app/rechenkern_bruecke.py Aufruf des Rechenkerns über Node
app/cli.py                Verwaltungsbefehle
alembic/                  Migrationen (laufen beim Containerstart automatisch)
tests/                    pytest (SQLite im Speicher + echter Rechenkern)
```

API-Dokumentation bei laufendem Container: http://127.0.0.1:8091/api/docs

## Befehle

```bash
# Ersten Admin anlegen (Passwort wird verdeckt abgefragt)
docker exec -it infrarot-backend python -m app.cli admin-anlegen --email NAME@FIRMA.de --name "Vorname Nachname"

# Weitere Benutzer
docker exec -it infrarot-backend python -m app.cli benutzer-anlegen --email … --name … --rolle berater
docker exec infrarot-backend python -m app.cli benutzer-deaktivieren --email …
docker exec infrarot-backend python -m app.cli email-aendern --alt ALTE@ADRESSE --neu NEUE@ADRESSE

# Tests
docker build -f backend/Dockerfile --target test -t infrarot-backend-test . && \
  docker run --rm --name infrarot-backend-test infrarot-backend-test

# Neue Migration nach Modelländerung (DB muss laufen)
docker compose run --rm --no-deps --name infrarot-backend-migration --user "$(id -u):$(id -g)" \
  -v "$PWD/backend/alembic/versions:/app/alembic/versions" infrarot-backend \
  alembic revision --autogenerate -m "Beschreibung"
```

## Rechte

- Alle angemeldeten Benutzer sehen und bearbeiten alle Projekte.
- Nur Admins: Projekte löschen, Benutzer verwalten, Bibliotheken importieren.
