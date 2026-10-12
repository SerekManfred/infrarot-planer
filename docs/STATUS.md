# Status

Stand: 12.10.2026, Ende Phase 1 Teil C

Ausrichtung: Vor-Ort-Planung von Infrarot-Deckenmodulen durch den Außendienst der MEH, Fachvorgaben und Prüfung durch die Energieberatung Serek. Fachregeln: `docs/FACHKONZEPT.md`. Betrieb und HTTPS: `docs/BETRIEB.md`.

## Was läuft

| Container | Erreichbar | Zustand |
|---|---|---|
| `infrarot-db` (PostgreSQL 16, Volume `infrarot-db-daten`) | nur intern, kein Host-Port | healthy, Migration `7c1e5a9d3b42` (Phase 1C) |
| `infrarot-backend` (FastAPI + Rechenkern 0.3.0, Volume `infrarot-uploads`) | `127.0.0.1:8091`, über Caddy `/api/*` | healthy |
| `infrarot-frontend` (React-PWA, nginx) | `127.0.0.1:8090`, über Caddy | läuft |

**Öffentlich:** https://ir-planer.mybase-test.de
- Zertifikat von Let's Encrypt, gültig bis 10.01.2027; Caddy verlängert es automatisch.
- HTTP leitet auf HTTPS um.
- Zugang über den Caddy-Container der Schulungsplattform. Das ist die eng begrenzte, freigegebene Ausnahme, siehe `docs/BETRIEB.md`:
  - nur ein neuer Site-Block im Caddyfile,
  - Caddy hängt zusätzlich am Netzwerk `infrarot-proxy`, das die Datenbank nicht erreicht,
  - übernommen per `caddy reload`, Caddy wurde nicht neu gestartet.
- Sicherung des Caddyfile: `/opt/schulung/Caddyfile.bak-2026-10-12`. Rückweg: `sudo bash betrieb/caddy_einrichten.sh rueckbau`.
- Die Infrarot-Ports bleiben nur an 127.0.0.1 gebunden.

**Daten:** ein Admin-Konto (serek.manfred@googlemail.com), keine Projekte, leere Bibliotheken. Fachvorgaben unverändert:
- Rückfallwerte: Neubau 40 W/m², Effizienzhaus-Sanierung 70 W/m², sonstiger Bestand leer
- Grenzhöhe für den Höhenzuschlag: 2,80 m
- ΔU_WB: 0,05 W/(m²K)

## Neu in Phase 1C

- **HTTPS und Sicherheits-Header:**
  - HSTS (1 Jahr), CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; der `Server`-Header ist entfernt.
  - Sitzungs-Cookie mit `Secure`, `HttpOnly`, `SameSite=Strict` und `Path=/api`.
- **PWA installierbar:** Manifest (`application/manifest+json`) und Service Worker. Die App startet ohne Netz.
- **Offline-Betrieb:**
  - Projekt „für Offline-Bearbeitung auschecken“, danach auf dem Gerät in IndexedDB bearbeiten, auch ohne Netz.
  - Der Schnappschuss der Fachvorgaben und Bibliotheken liegt mit auf dem Gerät.
  - Änderungen kommen in eine Warteschlange und werden automatisch übertragen, sobald der Server erreichbar ist.
  - Statusanzeige im Kopf: Online / Offline / x Änderungen ausstehend / Übertragung angehalten. Bei abgelehnten Änderungen gibt es die Wahl „erneut versuchen“ oder „verwerfen“.
  - Ohne Netz angelegte Projekte werden beim nächsten Kontakt angelegt und ausgecheckt.
- **Sperre:**
  - Ein ausgechecktes Projekt ist für alle anderen gesperrt. Die Anzeige nennt, wer es auf welchem Gerät seit wann hat.
  - Der Server prüft das über ein Sperr-Token je Gerät und antwortet sonst mit 423.
  - Ein Admin kann die Sperre lösen. Danach nimmt der Server alte Änderungen dieses Geräts nicht mehr an (409, wird angezeigt).
- **Rechenkern im Browser:**
  - Die Vorgaben-Auflösung (Herkunft, „Vorgabe fehlt“) liegt jetzt im Rechenkern (0.3.0).
  - Server und Tablet rechnen mit demselben Code. Alle bisherigen Backend-Auswertungstests laufen unverändert grün.
  - Gespeicherte Berechnungen enthalten jetzt den vollständigen Planungsstand (`eingaben.art = "objekt"`).
- **Abmelden:**
  - Mit Verbindung wird zuerst alles übertragen und eingecheckt. Danach werden die lokalen Daten gelöscht.
  - Bleibt etwas offen, fragt die App vorher nach.
  - Meldet sich auf dem Gerät ein anderer Benutzer an, während noch fremde Offline-Daten da sind, fragt die App ebenfalls.

Funktionen aus Phase 1B (Rollen, Status, Protokoll, Fachvorgaben, Heizlastquellen A/B/C, Schnellerfassung, Bremse, Benutzerverwaltung, Datensicherung) unverändert; Details in `docs/FACHKONZEPT.md`.

## Tests (alle grün)

| Bereich | Ergebnis |
|---|---|
| Rechenkern (Vitest) | 50 Tests, Typprüfung fehlerfrei; laufen bei jedem Backend-Build |
| Backend (pytest, mit echtem Rechenkern) | 53 Tests, davon 9 neu für Offline-Sperre, Admin-Lösen, 409 nach Lösen, Vorgaben-Schnappschuss und Projektpaket |
| Frontend (Vitest) | 24 Tests der Offline-Logik: lokale Bearbeitung, vorläufige IDs, Offline-Rechnen, Synchronisierung in Reihenfolge mit Sperr-Token, Konflikte, abgelaufene Anmeldung, Einchecken, offline angelegte Projekte, Abmelden. Laufen bei jedem Frontend-Build; `tsc` und `vite build` fehlerfrei |
| Migration | auf der echten Datenbank ausgeführt (vorher Sicherung), `alembic check`: Modell und Datenbank stimmen überein |
| Caddy | Konfiguration vorab in einem Wegwerf-Container geprüft; Skript lief am 12.10.2026; Schulungsplattform danach weiter per HTTPS erreichbar; Caddy nicht neu gestartet |
| Ende-zu-Ende über https://ir-planer.mybase-test.de | Mit zwei temporären Konten (Außendienst, Fachprüfer) 16 Prüfungen bestanden, Testkonten und Testdaten danach entfernt. Geprüft wurde: Cookie-Flags, Auschecken, Projektpaket, Schnappschuss, 423 ohne Token, Bearbeiten mit Token, Auswertung (Rechenkern 0.3.0, 4 × 5 m → 800 W mit Rückfallwert), Sperranzeige, 423 für den Fachprüfer bei Änderung, Status, fremdem Token und Einchecken, Einchecken durch das Gerät, 409 für das alte Token, danach Status möglich, Protokoll |

**Nicht automatisiert geprüft:** die Bedienung im echten Tablet-Browser, also Installation, Flugmodus und Statusanzeige. Bitte einmal nach der Anleitung unten durchspielen.

## App auf dem Tablet installieren

1. Im Browser des Tablets **https://ir-planer.mybase-test.de** öffnen und anmelden.
   - Android: Chrome
   - iPad: Safari
2. Installieren:
   - **Android (Chrome):** Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.
   - **iPad (Safari):** Teilen-Symbol → „Zum Home-Bildschirm“.
3. Die App über das neue Symbol „IR-Planer“ starten. Sie läuft dann ohne Browserleiste.
4. Vor dem Termin, mit Netz: Projekt öffnen und **„Für Offline-Bearbeitung auschecken“** tippen. Beim ersten Mal fragt die App nach einem Gerätenamen.
5. Vor Ort ohne Netz weiterarbeiten. Oben rechts steht „Offline · x ausstehend“.
6. Danach mit Netz: Die Änderungen gehen von selbst raus. Dann im Projekt **„Einchecken“**, damit der Fachprüfer prüfen kann.

Hinweise:
- Auf dem iPad hat die installierte App einen eigenen Speicher, getrennt von Safari. Auschecken also in der installierten App, nicht im Browser-Tab.
- Nicht über die Browser-Einstellungen die Website-Daten löschen, solange Änderungen ausstehen.

## Offen

**Fachliche Festlegungen (von Ihnen):**
- Höhenzuschlag: Zuschlag in % je Meter Mehrhöhe. Ohne diesen Wert wird kein Zuschlag gerechnet; Räume über 2,80 m zeigen „Vorgabe fehlt“.
- Rückfallwert für „sonstiger Bestand“: Soll dort die Sanierungs-Pauschale (70 W/m²) gelten oder ein eigener Wert? Derzeit leer, also „Vorgabe fehlt“.
- Raumtypen mit Pauschalen je Gebäudestandard; für die Gegenprobe C zusätzlich θint, Luftwechsel, Reduktionsfaktoren.
- CSV-Dateien: Klimadaten (DIN/TS 12831-1) und Pauschal-U-Werte (Bekanntmachung Wohngebäudebestand).
- Bestätigen: Admins prüfen und geben **nicht** frei (so umgesetzt).
- Bestätigen: Änderungen an Fachvorgaben wirken sofort auf alle nicht freigegebenen Projekte. Auf einem ausgecheckten Tablet gilt bis zum nächsten Kontakt der dort gespeicherte Schnappschuss.

**Als Nächstes geplant:** Modulkatalog, Sperrflächen, Platzierung, Angebot, Platzierungsplan.

**Später:** Hottgenroth-Import, Grundriss-Import per KI, Raumliste als PDF/Excel, Word-Bericht im CI.

**Betrieb:**
- Wird `schulung-caddy-1` von der Schulungsplattform einmal neu erstellt, fehlt die Netzwerkverbindung. Dann `docker network connect infrarot-proxy schulung-caddy-1` ausführen (`docs/BETRIEB.md`).
- Sicherungskopie außer Haus und Benachrichtigung bei fehlgeschlagener Sicherung.
- **Alte Docker-Volumes und ein altes Netzwerk** aus der früheren Installation:
  - Volumes: `infrarot-data`, `infrarot-planer_app-{data,uploads,outputs}`, `infrarot-planer-new_app-{data,uploads,outputs}`
  - Netzwerk: `infrarot-planer_infrarot-net`
  - Sie sind unverändert und werden nicht gesichert. Sie können Altdaten enthalten, auch einen gespeicherten API-Schlüssel (`api_key.txt`). Bitte entscheiden, ob sie gelöscht werden sollen.
- Die App-Icons und Farben sind Platzhalter bis zum CI.
