#!/usr/bin/env bash
# Prüft, ob sich die neueste Sicherung wiederherstellen lässt – ohne den laufenden Betrieb zu verändern:
#  1. Datenbank-Sicherung in eine TEMPORÄRE Datenbank im Container infrarot-db einspielen
#     und Zeilenzahlen aller Tabellen mit der laufenden Datenbank vergleichen; danach wieder löschen.
#  2. Uploads-Archiv in ein temporäres Verzeichnis entpacken und mit dem Volume vergleichen.
# Aufruf: betrieb/wiederherstellung_testen.sh [DB-Sicherung] [Uploads-Sicherung]
set -euo pipefail

ZIEL="${INFRAROT_BACKUP_ZIEL:-$HOME/backups/infrarot}"
PROJEKT="$(cd "$(dirname "$0")/.." && pwd)"
env_wert() { grep -E "^$1=" "$PROJEKT/.env" | tail -n1 | cut -d= -f2-; }
DB_BENUTZER="$(env_wert POSTGRES_USER)"
DB_NAME="$(env_wert POSTGRES_DB)"
TEST_DB="infrarot_wiederherstellungstest"

DB_DATEI="${1:-$(ls -1t "$ZIEL"/infrarot_db_*.dump | head -n1)}"
UPLOAD_DATEI="${2:-$(ls -1t "$ZIEL"/infrarot_uploads_*.tar.gz | head -n1)}"
TMP="$(mktemp -d)"
aufraeumen() {
  docker exec infrarot-db dropdb -U "$DB_BENUTZER" --if-exists "$TEST_DB" || true
  rm -rf "$TMP"
}
trap aufraeumen EXIT

echo "Datenbank-Sicherung: $DB_DATEI"
docker exec infrarot-db dropdb -U "$DB_BENUTZER" --if-exists "$TEST_DB"
docker exec infrarot-db createdb -U "$DB_BENUTZER" "$TEST_DB"
docker exec -i infrarot-db pg_restore -U "$DB_BENUTZER" -d "$TEST_DB" --no-owner --exit-on-error < "$DB_DATEI"

ZAEHLEN="SELECT string_agg(format('%s=%s', table_name,
  (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', table_name), false, true, '')))[1]::text),
  ' ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'public'"
original="$(docker exec infrarot-db psql -U "$DB_BENUTZER" -d "$DB_NAME" -Atc "$ZAEHLEN")"
wiederhergestellt="$(docker exec infrarot-db psql -U "$DB_BENUTZER" -d "$TEST_DB" -Atc "$ZAEHLEN")"
echo "  laufend:          $original"
echo "  wiederhergestellt: $wiederhergestellt"
if [ "$original" != "$wiederhergestellt" ]; then
  echo "ABWEICHUNG – hat sich die Datenbank seit der Sicherung geändert? Sonst Sicherung prüfen." >&2
  exit 1
fi

echo "Uploads-Sicherung: $UPLOAD_DATEI"
tar -xzf "$UPLOAD_DATEI" -C "$TMP"
docker exec infrarot-backend sh -c 'cd /app && find uploads -type f -exec sha256sum {} + | sort' > "$TMP/laufend.txt"
(cd "$TMP" && find uploads -type f -exec sha256sum {} + | sort) > "$TMP/wiederhergestellt.txt"
if ! diff -q "$TMP/laufend.txt" "$TMP/wiederhergestellt.txt" > /dev/null; then
  echo "ABWEICHUNG bei den Uploads:" >&2
  diff "$TMP/laufend.txt" "$TMP/wiederhergestellt.txt" >&2 || true
  exit 1
fi
echo "  $(wc -l < "$TMP/laufend.txt") Datei(en), Prüfsummen identisch"
echo "WIEDERHERSTELLUNG ERFOLGREICH GETESTET"
