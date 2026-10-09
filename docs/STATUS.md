# Status

Stand: 09.10.2026, Ende Phase 1 Teil A (Fundament)

## Was läuft

| Container | Image | Erreichbar | Zustand |
|---|---|---|---|
| `infrarot-db` | postgres:16.8-alpine, Volume `infrarot-db-daten` | nur im Netz `infrarot-netz`, kein Host-Port | läuft, healthy |
| `infrarot-backend` | eigenes Image (Python 3.12 + Node 22 für den Rechenkern) | `127.0.0.1:8091` | läuft, Migration `bff327302a79` angewendet |
| `infrarot-frontend` | nginx 1.27 mit gebauter PWA, `/api` → Backend | `127.0.0.1:8090` | läuft |

Nichts ist öffentlich erreichbar. Zugriff vom eigenen Rechner per SSH-Tunnel:

```bash
ssh -L 8090:127.0.0.1:8090 BENUTZER@SERVER    # dann http://localhost:8090 im Browser
```

Die Datenbank ist **leer**: kein Benutzer, keine Projekte, leere Bibliotheken.

## Tests (alle grün)

| Bereich | Werkzeug | Ergebnis |
|---|---|---|
| Rechenkern | Vitest 3.0.9 | 24 Tests bestanden, Typprüfung ohne Fehler (läuft auch bei jedem Backend-Build) |
| Backend | pytest 8.3.5 (SQLite im Speicher, echter Rechenkern) | 21 Tests bestanden |
| Frontend | `tsc` + `vite build` | Build ohne Fehler, PWA (Service Worker, Manifest) erzeugt; `npm audit --omit=dev`: 0 Schwachstellen |
| Ende-zu-Ende über 127.0.0.1:8090 | curl | Gesundheit, 401 ohne Anmeldung, 401 bei falschem Passwort, Anmeldung mit HttpOnly-Cookie, Projekt anlegen/auflisten/löschen, leere Bibliotheken, Berechnung meldet fehlende Kennwerte. Testkonto und Testprojekt anschließend entfernt. |

## Umgesetzt

- **Docker Compose** (`docker-compose.yml`, Projektname `infrarot`): drei Container, eigenes Volume und Netzwerk, Ports nur an 127.0.0.1, Zugangsdaten nur in `.env` (zufällig erzeugt, Rechte 600), Vorlage `.env.example`.
- **Datenmodell** (Alembic-Migration): Benutzer (Admin/Berater), Projekt → Objekt → Geschoss → Raum → Bauteilfläche → Öffnung; Bibliotheken Bauteile, Raumtypen, Klimadaten; Berechnung je Objekt fortlaufend versioniert mit vollständigem Eingabe-Schnappschuss, Ergebnis und Rechenkern-Version.
- **Anmeldung:** Argon2id-Passwort-Hashes, Sitzung als JWT im HttpOnly-/SameSite=Strict-Cookie, Admin per Kommandozeile.
- **API:** CRUD für alle Ebenen, Bibliotheken lesen, CSV-Import (Admin), Berechnung starten/auflisten/lesen. Doku: http://127.0.0.1:8091/api/docs
- **Rechenkern** (TypeScript): Φ_HL = Σ A·(U+ΔU_WB)·f · (θint − θe) + 0,34·n·V · (θint − θe), mit Öffnungsabzug, Temperatur-Korrekturfaktor, Eingabeprüfung mit Fehlerpfad. Formeln und Einheiten: `rechenkern/README.md`.
- **Keine erfundenen Werte:** Bibliotheken leer; Import nur mit Quellenangabe (`docs/CSV-FORMATE.md`); fehlende Kennwerte (θe, ΔU_WB, U, θint, n, V, f bei Erdreich) werden gemeldet statt geschätzt.
- **Frontend:** React-PWA mit Anmeldung, Projektliste und „Neues Projekt“; zeigt die Rechenkern-Version (derselbe Code wie auf dem Server).

## Erste Schritte für den Betrieb

```bash
cd ~/infrarot-planer
docker compose up -d --build                     # starten / aktualisieren
docker exec -it infrarot-backend python -m app.cli admin-anlegen --email … --name "…"
# Bibliotheken: CSV nach docs/CSV-FORMATE.md erstellen und importieren
docker compose stop                              # anhalten (nur infrarot-Container)
```

## Offen

**Daten, die Sie liefern bzw. freigeben müssen:**
- CSV mit Normaußentemperaturen aus DIN/TS 12831-1 (lizenzpflichtige Norm, deshalb nicht von mir erstellt).
- CSV mit Pauschal-U-Werten aus der Bekanntmachung für den Wohngebäudebestand.
- Raumtypen mit Norm-Innentemperaturen und Luftwechselraten samt Quelle.
- Festlegung zum Wärmebrückenzuschlag ΔU_WB (wird je Objekt eingegeben, es gibt keinen Vorgabewert).
- Ersten Admin anlegen (Befehl oben).

**Fachlich (nächste Teile):**
- Temperatur-Korrekturfaktoren für Erdreich/unbeheizte Räume: derzeit Eingabe von f oder der Nachbartemperatur; ein Hilfsverfahren nach Norm fehlt.
- Volumen aus Fläche × lichter Höhe; Abweichungen (Dachschrägen) nur über eigenen Volumenwert.
- Summe der Raumheizlasten ≠ Gebäudeheizlast; Gebäudeheizlast fehlt noch.
- Oberflächen für Objekt/Geschoss/Raum/Bauteile/Berechnung fehlen (API ist vorhanden).

**Technisch:**
- Offline-Speicher (IndexedDB) und Abgleich mit dem Server.
- HTTPS über den vorhandenen Caddy: dazu später `INFRAROT_COOKIE_SECURE=true` setzen und Caddy mit `infrarot-frontend` verbinden – **erst nach Absprache**, weil das den Caddy-Container betrifft.
- Schutz gegen massenhafte Anmeldeversuche (Rate-Limit), Passwort ändern, Benutzerverwaltung in der Oberfläche.
- Rechtekonzept prüfen: derzeit sehen alle Berater alle Projekte.
- Datensicherung des Volumes `infrarot-db-daten` einrichten.
- App-Icons und Farben sind Platzhalter bis zum CI.
