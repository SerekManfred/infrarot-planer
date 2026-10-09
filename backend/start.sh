#!/bin/sh
# Container-Start: Datenbank migrieren, dann API starten
set -e
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
