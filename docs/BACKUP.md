# Datensicherung und Wiederherstellung

Stand: 10.10.2026

## Was, wann, wohin

| | |
|---|---|
| **Inhalt** | Datenbank `infrarot` (Container `infrarot-db`, PostgreSQL-Custom-Format) und Uploads (Volume `infrarot-uploads`, tar.gz) – darin auch die Firmenlogos (`uploads/logos`, Paket M3) und die Sicherungen vor Importen |
| **Zeitpunkt** | täglich 01:30 UTC (03:30 MESZ / 02:30 MEZ), cron des Benutzers `dev` |
| **Ziel** | `~/backups/infrarot/` (Rechte 700, Dateien 600) |
| **Dateien** | `infrarot_db_JJJJMMTT_hhmmss.dump`, `infrarot_uploads_JJJJMMTT_hhmmss.tar.gz` |
| **Aufbewahrung** | 14 Tage; ältere Dateien dieser beiden Muster löscht das Skript selbst |
| **Protokoll** | `~/backups/infrarot/backup.log`, eine Zeile je Lauf (`OK …`), Fehler stehen ebenfalls dort |
| **Skript** | `betrieb/backup.sh` |

Cron-Eintrag (`crontab -l`):

```
30 1 * * * /home/dev/infrarot-planer/betrieb/backup.sh >> /home/dev/backups/infrarot/backup.log 2>&1
```

Das Skript prüft jede Sicherung direkt nach dem Erstellen (`pg_restore --list` bzw. `tar -t`) und benennt sie erst danach um. Abgebrochene Läufe hinterlassen keine halben Dateien. Es greift nur auf `infrarot-db` und `infrarot-backend` zu.

**Nicht enthalten:** die Datei `.env` mit Datenbankpasswort und JWT-Geheimnis. Sie muss getrennt sicher aufbewahrt werden, z. B. im Passwortmanager. Ohne sie lässt sich die Sicherung zwar einspielen, aber neu erzeugte Zugangsdaten sind dann nötig, und alle Benutzer müssen sich neu anmelden.

## Kontrolle

```bash
tail -n 5 ~/backups/infrarot/backup.log     # letzte Läufe
ls -lt ~/backups/infrarot/ | head           # neueste Dateien
betrieb/backup.sh                            # Sicherung sofort von Hand
```

## Wiederherstellung testen (ohne Eingriff in den Betrieb)

```bash
betrieb/wiederherstellung_testen.sh                    # neueste Sicherung
betrieb/wiederherstellung_testen.sh DB.dump UPLOADS.tar.gz
```

Das Skript spielt die Datenbanksicherung in eine **temporäre** Datenbank `infrarot_wiederherstellungstest` im Container `infrarot-db` ein und vergleicht die Zeilenzahlen aller Tabellen mit der laufenden Datenbank. Die Uploads entpackt es in ein temporäres Verzeichnis und vergleicht die SHA-256-Prüfsummen mit dem Volume. Danach räumt es alles wieder ab.

### Ergebnis des Tests am 10.10.2026

```
Datenbank-Sicherung: /home/dev/backups/infrarot/infrarot_db_20261010_074855.dump
  laufend:          alembic_version=1 anmeldeversuch=0 bauteilflaeche=0 benutzer=1 berechnung=0 bib_bauteil=0 bib_klimadaten=0 bib_raumtyp=0 fachvorgaben=1 geschoss=0 heizlast_pauschale=0 objekt=0 oeffnung=0 projekt=0 protokoll=0 raum=0
  wiederhergestellt: (identisch)
Uploads-Sicherung: /home/dev/backups/infrarot/infrarot_uploads_20261010_074855.tar.gz
  1 Datei(en), Prüfsummen identisch      ← eigens angelegte Prüfdatei, danach wieder entfernt
WIEDERHERSTELLUNG ERFOLGREICH GETESTET
```

Zusätzlich getestet: Aufbewahrung mit künstlich gealterten Dateien. 15 Tage alte Sicherungen wurden gelöscht, 13 Tage alte und fremde Dateien blieben erhalten. Außerdem ein Lauf in einer cron-gleichen Umgebung mit minimalem `PATH`.

Hinweis: Zum Testzeitpunkt enthielt die Datenbank nur das Admin-Konto und die Fachvorgaben. Den Test nach den ersten echten Projekten wiederholen.

## Wiederherstellung im Ernstfall

Alle Befehle im Projektverzeichnis `~/infrarot-planer`. **Nur Container mit Präfix `infrarot` anfassen.**

### 1. Datenbank

```bash
DUMP=~/backups/infrarot/infrarot_db_JJJJMMTT_hhmmss.dump     # gewünschte Sicherung
DB_BENUTZER=$(grep ^POSTGRES_USER= .env | cut -d= -f2-)
DB_NAME=$(grep ^POSTGRES_DB= .env | cut -d= -f2-)

# Vorher den aktuellen Stand sichern (falls noch lesbar)
betrieb/backup.sh

# Backend anhalten, damit niemand schreibt
docker compose stop infrarot-backend

# Datenbank leeren und Sicherung einspielen
docker exec infrarot-db dropdb -U "$DB_BENUTZER" "$DB_NAME"
docker exec infrarot-db createdb -U "$DB_BENUTZER" "$DB_NAME"
docker exec -i infrarot-db pg_restore -U "$DB_BENUTZER" -d "$DB_NAME" --no-owner --exit-on-error < "$DUMP"

# Backend starten (führt ggf. neuere Migrationen aus)
docker compose start infrarot-backend
curl -s http://127.0.0.1:8091/api/gesundheit
```

Ist der Container `infrarot-db` oder sein Volume selbst verloren: `docker compose up -d infrarot-db` legt beides neu an (mit den Zugangsdaten aus `.env`). Danach die Schritte ab „Sicherung einspielen“ ausführen; `dropdb` entfällt.

### 2. Uploads

```bash
ARCHIV=~/backups/infrarot/infrarot_uploads_JJJJMMTT_hhmmss.tar.gz
docker exec infrarot-backend sh -c 'rm -rf /app/uploads/* /app/uploads/.[!.]*'
docker exec -i infrarot-backend tar -xzf - -C /app < "$ARCHIV"
```

### 3. Prüfen

Anmelden, Projektliste und ein Projekt öffnen. Danach `betrieb/wiederherstellung_testen.sh` ausführen; die Zeilenzahlen müssen übereinstimmen.

## Offen

- **Nur auf demselben Server:** Fällt der Server oder seine Platte aus, sind die Sicherungen mit weg. Empfohlen ist eine zusätzliche Kopie außer Haus, z. B. nächtlich per `rsync`/`restic` auf einen zweiten Speicherort. Dafür braucht es ein Ziel und Zugangsdaten von Ihnen.
- **Keine Benachrichtigung bei Fehlern:** Ein fehlgeschlagener Lauf steht nur im Protokoll. Eine Mail- oder Monitoring-Anbindung folgt bei Bedarf.
- Die Sicherung `vor_phase1b_20261010_073833.dump` (Stand vor der Migration Phase 1B) fällt nicht unter die automatische Löschung und kann von Hand entfernt werden.
