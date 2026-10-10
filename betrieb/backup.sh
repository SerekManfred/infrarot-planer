#!/usr/bin/env bash
# Datensicherung Infrarot-Planer: Datenbank (pg_dump) und Uploads (tar.gz).
# Läuft täglich per cron als Benutzer dev; Beschreibung und Wiederherstellung: docs/BACKUP.md
#
# Ziel:        $INFRAROT_BACKUP_ZIEL  (Standard ~/backups/infrarot)
# Aufbewahrung $INFRAROT_BACKUP_TAGE  (Standard 14 Tage)
#
# Greift nur auf die Container infrarot-db und infrarot-backend zu.
set -euo pipefail

ZIEL="${INFRAROT_BACKUP_ZIEL:-$HOME/backups/infrarot}"
TAGE="${INFRAROT_BACKUP_TAGE:-14}"
PROJEKT="$(cd "$(dirname "$0")/.." && pwd)"
STEMPEL="$(date +%Y%m%d_%H%M%S)"

umask 077
mkdir -p "$ZIEL"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Nur die zwei benötigten Werte aus .env lesen (die Datei wird nicht ausgeführt)
env_wert() { grep -E "^$1=" "$PROJEKT/.env" | tail -n1 | cut -d= -f2-; }
DB_BENUTZER="$(env_wert POSTGRES_USER)"
DB_NAME="$(env_wert POSTGRES_DB)"

DB_DATEI="$ZIEL/infrarot_db_$STEMPEL.dump"
UPLOAD_DATEI="$ZIEL/infrarot_uploads_$STEMPEL.tar.gz"
trap 'rm -f "$DB_DATEI.tmp" "$UPLOAD_DATEI.tmp"' EXIT

# Datenbank im PostgreSQL-Custom-Format; danach Lesbarkeit mit pg_restore prüfen
docker exec infrarot-db pg_dump -U "$DB_BENUTZER" -d "$DB_NAME" -Fc > "$DB_DATEI.tmp"
docker exec -i infrarot-db pg_restore --list < "$DB_DATEI.tmp" > /dev/null
mv "$DB_DATEI.tmp" "$DB_DATEI"

# Uploads aus dem Volume infrarot-uploads (über den Backend-Container); danach Archiv prüfen
docker exec infrarot-backend tar -czf - -C /app uploads > "$UPLOAD_DATEI.tmp"
tar -tzf "$UPLOAD_DATEI.tmp" > /dev/null
mv "$UPLOAD_DATEI.tmp" "$UPLOAD_DATEI"

# Aufbewahrung: Sicherungen älter als $TAGE Tage löschen (nur eigene Dateimuster)
geloescht=$(find "$ZIEL" -maxdepth 1 -type f \( -name 'infrarot_db_*.dump' -o -name 'infrarot_uploads_*.tar.gz' \) \
  -mtime +"$((TAGE - 1))" -print -delete | wc -l)

log "OK  DB $(du -h "$DB_DATEI" | cut -f1)  Uploads $(du -h "$UPLOAD_DATEI" | cut -f1)  gelöscht: $geloescht"
