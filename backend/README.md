# backend

FastAPI-Anwendung mit SQLAlchemy 2 und Alembic auf PostgreSQL 16. Die Heizlast rechnet nicht Python, sondern der TypeScript-Rechenkern (`rechenkern/dist/cli.cjs`), der im Image mit Node aufgerufen wird. So ist das Ergebnis im Browser und auf dem Server identisch.

## Aufbau

```
app/main.py               App, Fehlerbehandlung, Router
app/models.py             Datenmodell (Benutzer, Projekt → Objekt → Geschoss → Raum → Bauteilfläche → Öffnung,
                          Fachvorgaben, Bibliotheken, Protokoll, Anmeldeversuche, versionierte Berechnungen)
app/schemas.py            API-Schemas
app/sicherheit.py         Argon2id-Passwörter, JWT im HttpOnly-Cookie
app/csv_import.py         CSV-Import der Bibliotheken (Format: docs/CSV-FORMATE.md)
app/auswertung.py         stellt den Planungsstand zusammen; Vorgaben-Auflösung und Rechnung im Rechenkern (art "objekt")
app/protokoll.py          Änderungsprotokoll (SQLAlchemy-Ereignis, erfasst jede Änderung mit Benutzer und Zeit)
app/projektzugriff.py     Projektzuordnung, Sperre freigegebener Projekte, Offline-Sperre (X-Sperre), Rückfall geprüft → Entwurf
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

# Weitere Benutzer (Rollen kombinierbar, kommagetrennt)
docker exec -it infrarot-backend python -m app.cli benutzer-anlegen --email … --name … --rollen aussendienst
docker exec infrarot-backend python -m app.cli rollen-setzen --email … --rollen admin,fachpruefer

# Passwort neu setzen (verdeckt, zweimal, mind. 12 Zeichen): meldet alle Sitzungen ab,
# hebt die Anmeldesperre des Kontos auf und protokolliert beides
docker exec -it infrarot-backend python -m app.cli passwort-setzen --email …
docker exec infrarot-backend python -m app.cli benutzer-deaktivieren --email …

# Importdatei des Auftraggebers (Raumtypen, Platzierungsregeln, Modulkatalog); erst Probelauf, vorher sichern
docker exec -i infrarot-backend python -m app.cli excel-importieren --probelauf < daten/IR-Planer_Importdaten_geprueft.xlsx
docker exec -i infrarot-backend python -m app.cli excel-importieren [--umbenennen ALT=NEU …] < daten/IR-Planer_Importdaten_geprueft.xlsx
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

| | Außendienst | Fachprüfer | Admin |
|---|---|---|---|
| Projekte sehen, anlegen, bearbeiten | ja | ja | ja |
| Projektstatus ändern (prüfen, freigeben, zurücksetzen) | – | ja | – |
| Fachvorgaben pflegen, Bibliotheken importieren | – | ja | ja |
| Benutzer verwalten | – | – | ja |
| Projekte löschen | – | – | ja |

Rollen sind kombinierbar; es gilt die Vereinigung der Rechte (z. B. Admin + Fachprüfer darf Benutzer verwalten **und** prüfen/freigeben). Prüfen und Freigeben setzt immer die Rolle Fachprüfer voraus.

Freigegebene Projekte sind für alle gesperrt. Ausgecheckte Projekte (Offline-Bearbeitung) darf nur das auscheckende Gerät ändern; einchecken kann das Gerät, die Sperre lösen ein Admin. Details: `docs/FACHKONZEPT.md`.

## Eingefrorene Fachvorgaben (`app/vorgabenstand.py`)

Jedes Projekt speichert beim Anlegen eine Kopie der Fachvorgaben (`projekt.vorgaben_stand`) und rechnet damit.

| Endpunkt | Zweck |
|---|---|
| `GET /api/projekte/{id}/vorgaben` | Stand des Projekts, Unterschiede zu den zentralen Vorgaben (alt/neu), Auswirkung auf die Heizlast; bei Freigabe keine Unterschiede |
| `POST /api/projekte/{id}/vorgaben/uebernehmen` | übernimmt die zentralen Vorgaben; Protokolleintrag `vorgaben_uebernommen` mit Unterschieden und Heizlast vorher/nachher; 409 bei Freigabe, 423 bei Sperre |

## Offline-Betrieb

| Endpunkt | Zweck |
|---|---|
| `POST /api/projekte/{id}/auschecken` `{"geraet": "…"}` | sperrt das Projekt für dieses Gerät, liefert das Sperr-Token (nur der SHA-256 wird gespeichert) |
| `POST /api/projekte/{id}/einchecken` | hebt die Sperre auf: das Gerät (mit Token) oder ein Admin |
| `GET /api/offline/vorgaben` | Schnappschuss: Fachvorgaben, Bauteile, Klimadaten |
| `GET /api/offline/projekte/{id}` | vollständiger Projektstand (Gebäude → Geschosse → Räume → Flächen → Öffnungen) |

Änderungen an einem ausgecheckten Projekt brauchen den Kopf `X-Sperre: <Token>` vom selben Benutzer, sonst **423 Locked**. Sendet ein Gerät ein Token, obwohl die Sperre aufgehoben wurde, antwortet der Server mit **409**.

## Anmeldung

- Bremse: nach 5 Fehlversuchen je Konto oder 20 je IP-Adresse innerhalb von 15 Minuten wird 15 Minuten lang abgewiesen (HTTP 429). Werte über `INFRAROT_ANMELDUNG_*` einstellbar.
- Passwortwechsel, Passwort-Neusetzen durch den Admin und Deaktivierung beenden alle anderen Sitzungen des Benutzers.
