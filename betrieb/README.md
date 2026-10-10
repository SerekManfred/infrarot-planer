# betrieb

Betriebsskripte. Sie greifen nur auf die Infrarot-Container zu – mit einer dokumentierten Ausnahme (`caddy_einrichten.sh`).

- `backup.sh` – tägliche Datensicherung von Datenbank und Uploads nach `~/backups/infrarot/`, 14 Tage Aufbewahrung (cron als `dev`)
- `wiederherstellung_testen.sh` – spielt die neueste Sicherung probeweise in eine temporäre Datenbank bzw. ein temporäres Verzeichnis ein und vergleicht
- `caddy_einrichten.sh` – HTTPS über den Caddy der Schulungsplattform: hängt nur den Block `caddy/ir-planer.caddy` an, mit Sicherung, Prüfung, Reload und automatischem Rückbau (`sudo`, Beschreibung in `docs/BETRIEB.md`); `… rueckbau` stellt die Sicherung wieder her

Beschreibung und Wiederherstellung im Ernstfall: `docs/BACKUP.md`. Betrieb und HTTPS: `docs/BETRIEB.md`.
