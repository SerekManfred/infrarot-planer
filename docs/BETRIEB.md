# Betrieb

Stand: 10.10.2026 (Phase 1C)

## Übersicht

```
Internet ──443──▶ schulung-caddy-1 (Caddy der Schulungsplattform, TLS über Let's Encrypt)
                     │  schulung.mybase-test.de  → schulung-web-1            (unverändert)
                     │  ir-planer.mybase-test.de → Netzwerk infrarot-proxy:
                     │        /api/*  → infrarot-backend:8000
                     │        sonst   → infrarot-frontend:80 (nginx, PWA)
                     ▼
              infrarot-netz (intern): infrarot-backend ↔ infrarot-db
```

- Die Infrarot-Container binden ihre Ports nur an `127.0.0.1` (8090 Frontend, 8091 Backend). Von außen ist die App nur über Caddy erreichbar.
- Caddy hängt **nur** am Netzwerk `infrarot-proxy`. Daran hängen Frontend und Backend, die Datenbank nicht.
- `infrarot-proxy` wird außerhalb von Compose angelegt (`external: true`). Ein `docker compose down` im Projekt entfernt es deshalb nicht, solange Caddy daran hängt.

## Ausnahme von der Regel „Caddy nicht anfassen“

Für HTTPS wurde der Caddy-Container der Schulungsplattform **eng begrenzt** verändert:

| Was | Wie |
|---|---|
| `/opt/schulung/Caddyfile` | **nur ein neuer Site-Block** angehängt (Inhalt: `betrieb/caddy/ir-planer.caddy`); der Block `schulung.mybase-test.de` ist unverändert |
| Netzwerk | `docker network connect infrarot-proxy schulung-caddy-1` |
| Übernahme | `caddy validate`, danach `caddy reload`. Kein Neustart, kein Neuerstellen des Containers |
| Sicherung | `/opt/schulung/Caddyfile.bak-JJJJ-MM-TT` (gleiche Rechte wie das Original) |

Alles erledigt ein Skript (root nötig, weil das Caddyfile root gehört):

```bash
sudo bash betrieb/caddy_einrichten.sh
```

Das Skript prüft der Reihe nach:

1. DNS (`ir-planer.mybase-test.de` → `187.124.191.5`, sonst Abbruch ohne Änderung).
2. Erreichbarkeit der Schulungsplattform **vor** der Änderung.
3. Die neue Konfiguration in einem Wegwerf-Container mit demselben Caddy-Image (`infrarot-caddy-pruefung`).
4. Nach dem Schreiben erneut im laufenden Caddy (`caddy validate`), danach `caddy reload`.
5. Die Erreichbarkeit der Schulungsplattform **nach** dem Neuladen. Wenn nicht: sofortiger Rückbau.
6. `https://ir-planer.mybase-test.de/api/gesundheit` (Zertifikat).

Wichtig: Das Caddyfile ist als **einzelne Datei** in den Container eingebunden (`/opt/schulung/Caddyfile → /etc/caddy/Caddyfile`, schreibgeschützt). Änderungen müssen die Datei an Ort und Stelle überschreiben (`cat neu > Caddyfile`). Editoren, die eine neue Datei anlegen (neuer Inode), werden vom Container nicht gesehen.

### Rückweg

```bash
sudo bash betrieb/caddy_einrichten.sh rueckbau
```

Das spielt die jüngste Sicherung `/opt/schulung/Caddyfile.bak-*` an Ort und Stelle zurück, lädt Caddy neu und trennt das Netzwerk `infrarot-proxy` vom Caddy-Container. Von Hand geht es so:

```bash
sudo sh -c 'cat /opt/schulung/Caddyfile.bak-JJJJ-MM-TT > /opt/schulung/Caddyfile'
docker exec schulung-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
docker network disconnect infrarot-proxy schulung-caddy-1
```

### Achtung bei Änderungen an der Schulungsplattform

- Wird `schulung-caddy-1` über deren Compose **neu erstellt**, fehlt danach die Netzwerkverbindung. Dann einmal `docker network connect infrarot-proxy schulung-caddy-1` ausführen. Der Site-Block im Caddyfile bleibt erhalten.
- Wird das Caddyfile der Schulungsplattform ersetzt, muss der Block aus `betrieb/caddy/ir-planer.caddy` wieder angehängt werden (Skript erneut ausführen).

## Sicherheits-Header

| Header | Wo | Wert |
|---|---|---|
| Strict-Transport-Security | Caddy | `max-age=31536000` (ohne `includeSubDomains`, betrifft nur diese Domain) |
| X-Content-Type-Options, Referrer-Policy, X-Frame-Options | Caddy und nginx | `nosniff`, `same-origin`, `DENY` |
| Content-Security-Policy | nginx | `default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| Permissions-Policy | nginx | Kamera, Mikrofon, Standort, Zahlung aus |
| `Server` | Caddy | entfernt |

Caddy leitet HTTP automatisch auf HTTPS um.

**Cookies:** Das Sitzungs-Cookie ist `HttpOnly`, `SameSite=Strict`, `Path=/api` und wegen `INFRAROT_COOKIE_SECURE=true` (`.env`) auch `Secure`, wird also nur über HTTPS gesendet. Über den SSH-Tunnel (`http://localhost:8090`) nehmen Chrome und Firefox das Cookie trotzdem an, weil sie `localhost` als sicher behandeln.

**Client-IP für die Anmelde-Bremse:** Caddy übernimmt keine `X-Forwarded-For`-Angaben aus dem Internet, sondern setzt die echte Client-IP. Das Backend nimmt den ersten Eintrag.

## Offline-Betrieb (PWA)

- Die App wird vom Service Worker zwischengespeichert und startet auch ohne Netz. API-Aufrufe werden nie aus diesem Cache beantwortet.
- Daten für die Offline-Arbeit liegen im Browser in IndexedDB (`infrarot-planer`):
  - ausgecheckte Projekte
  - Warteschlange der Änderungen
  - Schnappschuss der Fachvorgaben und Bibliotheken
  - zuletzt geladene Projektliste
- Die App bittet den Browser um dauerhaften Speicher (`navigator.storage.persist()`). Bei installierter App wird das in der Regel gewährt.
- Sperren und Abläufe: `docs/FACHKONZEPT.md`, Abschnitt Offline-Betrieb.

## Zugang ohne Caddy (Wartung)

```bash
ssh -L 8090:127.0.0.1:8090 BENUTZER@SERVER   # dann http://localhost:8090
```
