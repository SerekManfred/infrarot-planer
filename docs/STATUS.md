# Status

Stand: 12.10.2026, Ende Phase 1 Teil D (Festlegungen des Auftraggebers umgesetzt)

Ausrichtung: Vor-Ort-Planung von Infrarot-Deckenmodulen durch den Außendienst der MEH, Fachvorgaben und Prüfung durch die Energieberatung Serek. Fachregeln: `docs/FACHKONZEPT.md`. Betrieb und HTTPS: `docs/BETRIEB.md`.

## Was läuft

| Container | Erreichbar | Zustand |
|---|---|---|
| `infrarot-db` (PostgreSQL 16, Volume `infrarot-db-daten`) | nur intern, kein Host-Port | healthy, Migration `a4d2c8e61f07` (Phase 1D) |
| `infrarot-backend` (FastAPI + Rechenkern 0.4.0, Volume `infrarot-uploads`) | `127.0.0.1:8091`, über Caddy `/api/*` | healthy |
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

**Daten:** ein Konto, serek.manfred@googlemail.com, mit den Rollen **Admin + Fachprüfer**. Die E-Mail-Adresse war bereits richtig, das Passwort ist unverändert. Keine Projekte, leere Bibliotheken. Fachvorgaben:
- Rückfallwerte: Neubau 40 W/m², Effizienzhaus-Sanierung 70 W/m²; „sonstiger Bestand“ bewusst ohne Rückfallwert (Pauschale je Raum Pflicht)
- Hinweis „Pauschale prüfen“ ab Raumhöhe 2,80 m (kein Zuschlag)
- ΔU_WB: 0,05 W/(m²K)

**Alte Docker-Volumes** der früheren Installation sind gelöscht, nach Prüfung, dass kein Container sie nutzt. Inhalte wurden nicht angesehen. Gelöscht wurden `infrarot-data`, `infrarot-planer_app-{data,uploads,outputs}` und `infrarot-planer-new_app-{data,uploads,outputs}`. Übrig sind nur `infrarot-db-daten` und `infrarot-uploads`.

## Neu in Phase 1D (Festlegungen vom 12.10.2026)

1. **Kein Höhenzuschlag.** Bei Räumen über 2,80 m erscheint nur „Raumhöhe über 2,80 m – Pauschale prüfen und ggf. manuell anpassen.“ Wird die Pauschale für den Raum von Hand gesetzt, verschwindet der Hinweis.
2. **„sonstiger Bestand“:**
   - kein Rückfallwert und keine Tabellenwerte (der Server lehnt sie ab);
   - die W/m²-Pauschale ist in jeder Raumkarte ein Pflichtfeld, rot markiert, solange es leer ist;
   - dazu der Hinweis, dass Infrarot nicht empfohlen wird.
3. **Rollen kombinierbar.**
   - Prüfen und Freigeben gehen nur mit der Rolle Fachprüfer. Ein Konto mit nur Admin darf es weiterhin nicht.
   - In der Benutzerverwaltung lassen sich mehrere Rollen wählen.
   - Über die Kommandozeile: `rollen-setzen`.
4. **Fachvorgaben je Projekt eingefroren:**
   - Das Projekt speichert beim Anlegen eine Kopie der Vorgaben und rechnet nur damit, auch offline.
   - Ändern sich die zentralen Vorgaben, erscheint im Projekt ein orangefarbener Hinweis. Er zeigt die Unterschiede alt/neu, die Heizlast-Summe vorher/nachher und die betroffenen Räume.
   - „Neue Vorgaben übernehmen“ wird mit allen Unterschieden protokolliert.
   - Freigegebene Projekte bleiben unverändert.

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
| Rechenkern (Vitest) | 49 Tests (Höhenzuschlag-Tests ersetzt durch Hinweis- und „sonstiger Bestand“-Tests), Typprüfung fehlerfrei; laufen bei jedem Backend-Build |
| Backend (pytest, mit echtem Rechenkern) | 62 Tests, davon neu: eingefrorene Vorgaben (Unterschiede, Auswirkung, Übernahme mit Protokoll, Freigabe unverändert, Sperre, Rücksetzung auf Entwurf), kombinierte Rollen (Admin + Fachprüfer gibt frei, nur Admin nicht), Rollen in Verwaltung und Kommandozeile, „sonstiger Bestand“, Hinweis-Höhe |
| Frontend (Vitest) | 27 Tests der Offline-Logik, neu: Rechnen mit dem eingefrorenen Projektstand, Hinweis statt Zuschlag, Übernahme erst nach dem Einchecken. Laufen bei jedem Frontend-Build; `tsc` und `vite build` fehlerfrei |
| Migration | Phase 1D auf der echten Datenbank ausgeführt (vorher Sicherung), `alembic check`: Modell und Datenbank stimmen überein |
| Ende-zu-Ende Phase 1D über HTTPS | Mit einem temporären Konto geprüft, danach entfernt: Vorgaben-Stand beim Anlegen, 3,20 m hoher Raum → 800 W ohne Zuschlag mit Hinweis, „sonstiger Bestand“ ohne Raumpauschale ohne Ergebnis, mit 120 W/m² → 2 400 W, Außendienst darf nicht prüfen |
| Caddy | Konfiguration vorab in einem Wegwerf-Container geprüft; Skript lief am 12.10.2026; Schulungsplattform danach weiter per HTTPS erreichbar; Caddy nicht neu gestartet |
| Ende-zu-Ende Phase 1C über https://ir-planer.mybase-test.de | Mit zwei temporären Konten (Außendienst, Fachprüfer) 16 Prüfungen bestanden, Testkonten und Testdaten danach entfernt. Geprüft wurde: Cookie-Flags, Auschecken, Projektpaket, Schnappschuss, 423 ohne Token, Bearbeiten mit Token, Auswertung (Rechenkern 0.3.0, 4 × 5 m → 800 W mit Rückfallwert), Sperranzeige, 423 für den Fachprüfer bei Änderung, Status, fremdem Token und Einchecken, Einchecken durch das Gerät, 409 für das alte Token, danach Status möglich, Protokoll |

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

**Fachliche Zulieferung (von Ihnen):**
- Raumtypen mit Pauschalen je Gebäudestandard (Neubau, Effizienzhaus-Sanierung). Bis dahin gelten 40 / 70 W/m².
  - Nach dem Einpflegen erscheinen die neuen Werte in bestehenden Projekten als Unterschied und werden dort per Klick übernommen.
- Niedrige Priorität, nur für Quelle C: Klimadaten (DIN/TS 12831-1) und Pauschal-U-Werte als CSV, θint, Luftwechsel und Reduktionsfaktoren je Raumtyp.

**Als Nächstes geplant:** Modulkatalog, Sperrflächen, Platzierung, Angebot, Platzierungsplan.

**Später:** Hottgenroth-Import, Grundriss-Import per KI, Raumliste als PDF/Excel, Word-Bericht im CI.

**Betrieb:**
- Wird `schulung-caddy-1` von der Schulungsplattform einmal neu erstellt, fehlt die Netzwerkverbindung. Dann `docker network connect infrarot-proxy schulung-caddy-1` ausführen (`docs/BETRIEB.md`).
- Sicherungskopie außer Haus und Benachrichtigung bei fehlgeschlagener Sicherung.
- Aus der früheren Installation ist noch das leere Netzwerk `infrarot-planer_infrarot-net` übrig. Es wurde nicht gelöscht, weil nur die Volumes beauftragt waren. Es enthält keine Daten. Löschen geht mit `docker network rm infrarot-planer_infrarot-net`.
- Die App-Icons und Farben sind Platzhalter bis zum CI.
