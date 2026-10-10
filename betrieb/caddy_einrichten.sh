#!/usr/bin/env bash
# HTTPS für den Infrarot-Planer über den bestehenden Caddy-Container der Schulungsplattform.
#
#   sudo bash betrieb/caddy_einrichten.sh            Site-Block ergänzen (mit Sicherung, Prüfung, Rückweg)
#   sudo bash betrieb/caddy_einrichten.sh rueckbau   letzte Sicherung zurückspielen und Netzwerk trennen
#
# Eng begrenzte Ausnahme von der Regel „Caddy nicht anfassen“ (docs/BETRIEB.md):
# - Der bestehende Inhalt des Caddyfile bleibt unverändert; es wird nur der Block aus betrieb/caddy/ir-planer.caddy angehängt.
# - Caddy wird nicht neu erstellt und nicht neu gestartet, nur neu geladen (caddy reload).
# - Caddy wird zusätzlich an das Netzwerk infrarot-proxy gehängt (docker network connect).
# - Ist die Schulungsplattform danach nicht mehr erreichbar, wird sofort zurückgebaut.
#
# Braucht root nur, weil /opt/schulung/Caddyfile root gehört. Das Caddyfile ist als einzelne Datei in den Container
# eingebunden; es wird deshalb an Ort und Stelle überschrieben (gleicher Inode), sonst sähe der Container die Änderung nicht.
set -euo pipefail

CADDYFILE=/opt/schulung/Caddyfile
CONTAINER=schulung-caddy-1
NETZ=infrarot-proxy
DOMAIN=ir-planer.mybase-test.de
SERVER_IP=187.124.191.5
SCHULUNG_URL=https://schulung.mybase-test.de/
BLOCK="$(cd "$(dirname "$0")" && pwd)/caddy/ir-planer.caddy"

log() { echo "$(date '+%H:%M:%S') $*"; }
abbruch() { log "ABBRUCH: $*"; exit 1; }

[[ $EUID -eq 0 ]] || abbruch "bitte mit sudo ausführen"
docker inspect "$CONTAINER" >/dev/null 2>&1 || abbruch "Container $CONTAINER nicht gefunden"

status_schulung() { curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$SCHULUNG_URL" || echo 000; }
schulung_ok() { local c; c="$(status_schulung)"; [[ $c =~ ^[23] ]]; }
neu_laden() { docker exec "$CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; }

zurueckspielen() {
  local sicherung="$1"
  log "Rückbau: $sicherung → $CADDYFILE"
  cat "$sicherung" > "$CADDYFILE"
  neu_laden || log "WARNUNG: Neuladen nach Rückbau fehlgeschlagen – Caddy läuft mit der zuletzt gültigen Konfiguration weiter"
  if docker inspect "$CONTAINER" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"$NETZ\""; then
    docker network disconnect "$NETZ" "$CONTAINER" && log "Netzwerk $NETZ von $CONTAINER getrennt"
  fi
  schulung_ok && log "Schulungsplattform erreichbar ($(status_schulung))" || log "WARNUNG: Schulungsplattform antwortet mit $(status_schulung)"
}

if [[ ${1:-} == rueckbau ]]; then
  sicherung="$(ls -1t "$CADDYFILE".bak-* 2>/dev/null | head -n1)"
  [[ -n $sicherung ]] || abbruch "keine Sicherung $CADDYFILE.bak-* gefunden"
  zurueckspielen "$sicherung"
  exit 0
fi

# 1. DNS
ip="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')"
[[ $ip == "$SERVER_IP" ]] || abbruch "$DOMAIN löst auf „${ip:-nichts}“ auf, erwartet $SERVER_IP"
log "DNS: $DOMAIN → $ip"
grep -q "^$DOMAIN {" "$CADDYFILE" && abbruch "$DOMAIN steht bereits im Caddyfile – nichts geändert"
schulung_ok || abbruch "Schulungsplattform schon vorher nicht erreichbar ($(status_schulung)) – nichts geändert"
log "Schulungsplattform vorher: $(status_schulung)"

# 2. Sicherung mit Datum
sicherung="$CADDYFILE.bak-$(date +%Y-%m-%d)"
[[ -e $sicherung ]] && sicherung="$sicherung-$(date +%H%M%S)"
cp -p "$CADDYFILE" "$sicherung"
log "Sicherung: $sicherung"

# 3. Neue Konfiguration = bisheriger Inhalt unverändert + neuer Block; vorab in einem Wegwerf-Container prüfen
neu="$(mktemp)"
trap 'rm -f "$neu"' EXIT
{ cat "$CADDYFILE"; sed "s/DATUM/$(date +%Y-%m-%d)/" "$BLOCK"; } > "$neu"
chmod 644 "$neu"
bild="$(docker inspect "$CONTAINER" --format '{{.Image}}')"
docker run --rm --name infrarot-caddy-pruefung -v "$neu":/etc/caddy/Caddyfile:ro "$bild" \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
  || abbruch "neue Konfiguration ungültig – nichts geändert (Sicherung bleibt liegen)"
log "Neue Konfiguration gültig (Prüfung im Wegwerf-Container)"

# 4. Verbindung Caddy → Infrarot-Container: nur das Netzwerk infrarot-proxy anhängen
if ! docker inspect "$CONTAINER" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"$NETZ\""; then
  docker network connect "$NETZ" "$CONTAINER"
  log "Netzwerk $NETZ an $CONTAINER angehängt"
fi

# 5. Übernehmen: an Ort und Stelle schreiben, im laufenden Caddy prüfen, neu laden (kein Neustart)
cat "$neu" > "$CADDYFILE"
if ! docker exec "$CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  zurueckspielen "$sicherung"
  abbruch "Prüfung im Caddy-Container fehlgeschlagen – zurückgebaut"
fi
if ! neu_laden; then
  zurueckspielen "$sicherung"
  abbruch "caddy reload fehlgeschlagen – zurückgebaut"
fi
log "Caddy neu geladen"

# 6. Kontrolle: Schulungsplattform zuerst; bei Problemen sofort zurück
sleep 3
if ! schulung_ok; then
  zurueckspielen "$sicherung"
  abbruch "Schulungsplattform nach dem Neuladen nicht erreichbar – zurückgebaut"
fi
log "Schulungsplattform nachher: $(status_schulung)"

# Zertifikat für die neue Domain kann einige Sekunden dauern
for _ in $(seq 1 24); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/api/gesundheit" 2>/dev/null || true)"
  [[ $code == 200 ]] && break
  sleep 5
done
if [[ ${code:-} == 200 ]]; then
  log "https://$DOMAIN erreichbar, Zertifikat gültig"
else
  log "WARNUNG: https://$DOMAIN antwortet noch nicht (${code:-keine Antwort}). Schulungsplattform ist in Ordnung;"
  log "         Caddy-Log prüfen: docker logs --since 10m $CONTAINER"
fi
log "Fertig. Rückweg: sudo bash $(dirname "$0")/caddy_einrichten.sh rueckbau"
