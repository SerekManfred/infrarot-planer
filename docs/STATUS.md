# Status

Stand: 10.10.2026, Ende Phase 1 Teil B

Ausrichtung: Vor-Ort-Planung von Infrarot-Deckenmodulen durch den Außendienst der MEH, Fachvorgaben und Prüfung durch die Energieberatung Serek. Fachregeln: `docs/FACHKONZEPT.md`.

## Was läuft

| Container | Erreichbar | Zustand |
|---|---|---|
| `infrarot-db` (PostgreSQL 16, Volume `infrarot-db-daten`) | nur intern, kein Host-Port | healthy, Migration `2f7f639cc127` (Phase 1B) |
| `infrarot-backend` (FastAPI + Rechenkern 0.2.0, Volume `infrarot-uploads`) | `127.0.0.1:8091` | healthy |
| `infrarot-frontend` (React-PWA, nginx) | `127.0.0.1:8090` | läuft |

Nichts ist öffentlich erreichbar. Zugriff per SSH-Tunnel: `ssh -L 8090:127.0.0.1:8090 BENUTZER@SERVER`, dann http://localhost:8090. Caddy und die Schulungsplattform wurden nicht verändert.

**Daten:** Es gibt ein Admin-Konto (serek.manfred@googlemail.com), keine Projekte und leere Bibliotheken. Die Fachvorgaben enthalten nur die festgelegten Werte:
- Rückfallwerte: Neubau 40 W/m², Effizienzhaus-Sanierung 70 W/m², sonstiger Bestand leer
- Grenzhöhe für den Höhenzuschlag: 2,80 m
- ΔU_WB: 0,05 W/(m²K)

## Funktionen (Phase 1B)

- **Rollen:** Außendienst MEH, Fachprüfer Serek, Admin. Alle sehen alle Projekte.
- **Projektstatus:** Vor-Ort-Entwurf → fachlich geprüft → freigegeben, Statuswechsel nur durch Fachprüfer.
  - Ändert jemand Daten eines geprüften Projekts, fällt es auf „Entwurf“ zurück.
  - Freigegebene Projekte sind gesperrt. Die Freigabe speichert die Auswertung als unveränderliche Berechnung.
- **Änderungsprotokoll:** Jede Änderung an Projekt- und Vorgabedaten wird mit Benutzer, Zeit und alt → neu protokolliert, auch über die Kommandozeile.
- **Fachvorgaben** (Pflege durch Fachprüfer und Admins):
  - Pauschalen-Matrix Raumtyp × Gebäudestandard, Rückfallwerte, Höhenzuschlag, ΔU_WB
  - je Raumtyp: θint, Luftwechsel, Reduktionsfaktor
  - Abweichungen je Projekt (Gebäude) und je Raum; jeder Wert zeigt seine Herkunft
  - Fehlende Werte erscheinen als „Vorgabe fehlt“ und werden nicht geschätzt.
- **Gebäudestandard** ist Pflicht. Bei „sonstiger Bestand“ erscheint der Hinweis zur Nichtempfehlung, die Berechnung bleibt möglich.
- **Heizlastquellen je Raum:**
  - A Pauschal (Standard), mit Höhenzuschlag
  - B Hottgenroth, manuelle Eingabe
  - C vereinfachte Berechnung als Gegenprobe mit Abweichung in %
- **Schnellerfassung am Tablet:**
  - Geschoss-Knöpfe, Raum als Rechteck mit Länge, Breite, Höhe und Raumtyp
  - Fläche und Heizlast erscheinen sofort, große Bedienelemente
  - Bauteilmasken nur aufklappbar für Quelle C
- **Sicherheit:**
  - Bremse bei Fehlanmeldungen: 5 Fehlversuche je Konto oder 20 je IP in 15 Minuten führen zu 15 Minuten Sperre.
  - Benutzer können ihr Passwort ändern. Ein Passwortwechsel meldet alle anderen Geräte ab.
  - Admins verwalten Benutzer: anlegen, Rolle ändern, deaktivieren (sofort abgemeldet), Passwort neu setzen. Admins können sich nicht selbst aussperren, und mindestens ein aktiver Admin bleibt immer erhalten.
- **Datensicherung:**
  - täglich 01:30 UTC nach `~/backups/infrarot/`, 14 Tage Aufbewahrung
  - Wiederherstellung getestet, Beschreibung in `docs/BACKUP.md`

## Tests (alle grün)

| Bereich | Ergebnis |
|---|---|
| Rechenkern (Vitest) | 40 Tests, Typprüfung fehlerfrei (laufen auch bei jedem Backend-Build) |
| Backend (pytest, mit echtem Rechenkern) | 44 Tests: Anmeldung, Bremse, Passwort, Rollen, Benutzerverwaltung, Schnellerfassung, Quellen A/B/C, Herkunft und „Vorgabe fehlt“, Höhenzuschlag, Status und Sperre, Protokoll, Versionierung |
| Frontend | `tsc` + `vite build` fehlerfrei, PWA erzeugt |
| Migration | auf der echten Datenbank ausgeführt; `alembic check`: Modell und Datenbank stimmen überein |
| Ende-zu-Ende über 127.0.0.1:8090 | mit zwei temporären Konten (Außendienst, Fachprüfer) geprüft: Projekt ohne Gebäudestandard abgelehnt, Raum 4 × 5 × 3,0 m → 20 m², 40 W/m² (Rückfallwert) → 800 W mit Hinweis „Vorgabe fehlt: Höhenzuschlag“; Prüfen durch Außendienst 403, Prüfen und Freigeben durch Fachprüfer, Änderung danach 409, Auswertung eingefroren, Protokoll mit Namen, Bremse greift beim 6. Versuch. Testkonten und Testdaten danach entfernt. |
| Datensicherung | Sicherung, Wiederherstellung in Testdatenbank (Zeilenzahlen identisch), Uploads (Prüfsummen identisch), Aufbewahrung, Lauf in cron-gleicher Umgebung |

## Offen

**Fachliche Festlegungen (von Ihnen):**
- Höhenzuschlag: Zuschlag in % je Meter Mehrhöhe. Ohne diesen Wert wird kein Zuschlag gerechnet; Räume über 2,80 m zeigen „Vorgabe fehlt“.
- Rückfallwert für „sonstiger Bestand“: Soll dort die Sanierungs-Pauschale (70 W/m²) gelten oder ein eigener Wert? Derzeit leer, also „Vorgabe fehlt“.
- Raumtypen mit Pauschalen je Gebäudestandard; für die Gegenprobe C zusätzlich θint, Luftwechsel, Reduktionsfaktoren.
- CSV-Dateien: Klimadaten (DIN/TS 12831-1) und Pauschal-U-Werte (Bekanntmachung Wohngebäudebestand).
- Bestätigen: Admins prüfen und geben **nicht** frei (so umgesetzt). Eine Person, die beides braucht, bekommt die Rolle Fachprüfer.
- Bestätigen: Änderungen an Fachvorgaben wirken sofort auf alle nicht freigegebenen Projekte, auch auf bereits geprüfte.

**Als Nächstes geplant (bewusst noch nicht gebaut):** Modulkatalog, Sperrflächen, Platzierung, Angebot, Platzierungsplan.

**Später:** Hottgenroth-Import, Grundriss-Import per KI, Offline-Speicher (IndexedDB), Raumliste als PDF/Excel, Word-Bericht im CI.

**Betrieb:**
- HTTPS über Caddy (erst nach Ihrer Freigabe, da der Caddy-Container betroffen ist); dann `INFRAROT_COOKIE_SECURE=true`.
- Sicherungskopie außer Haus und Benachrichtigung bei fehlgeschlagener Sicherung.
- **Alte Docker-Volumes** aus der früheren Installation: `infrarot-data`, `infrarot-planer_app-{data,uploads,outputs}`, `infrarot-planer-new_app-{data,uploads,outputs}`. Sie sind unverändert und werden nicht gesichert. Sie können noch Altdaten enthalten, auch einen dort gespeicherten API-Schlüssel (`api_key.txt`). Bitte entscheiden, ob sie gelöscht werden sollen.
- Die App-Icons und Farben sind Platzhalter bis zum CI.
