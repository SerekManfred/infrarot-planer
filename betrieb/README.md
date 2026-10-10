# betrieb

Betriebsskripte. Sie greifen nur auf die Container `infrarot-db` und `infrarot-backend` zu.

- `backup.sh` – tägliche Datensicherung von Datenbank und Uploads nach `~/backups/infrarot/`, 14 Tage Aufbewahrung (cron als `dev`)
- `wiederherstellung_testen.sh` – spielt die neueste Sicherung probeweise in eine temporäre Datenbank bzw. ein temporäres Verzeichnis ein und vergleicht

Beschreibung und Wiederherstellung im Ernstfall: `docs/BACKUP.md`.
