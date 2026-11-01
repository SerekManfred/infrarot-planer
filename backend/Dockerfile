# Build-Kontext ist das Projektverzeichnis (wegen rechenkern/).

# ── Rechenkern testen und bündeln ──
FROM node:22.14.0-bookworm-slim AS rechenkern
WORKDIR /rechenkern
COPY rechenkern/package.json rechenkern/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY rechenkern/ ./
RUN npm test && npm run typecheck && npm run build:cli

# ── Laufzeit ──
FROM python:3.12.9-slim-bookworm AS laufzeit
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# Nur die Node-Binärdatei für den Rechenkern-Aufruf
COPY --from=rechenkern /usr/local/bin/node /usr/local/bin/node
COPY --from=rechenkern /rechenkern/dist/cli.cjs /opt/rechenkern/cli.cjs
# pg_dump 16 (passend zum Datenbankserver) für Sicherungen vor Importen, aus dem offiziellen PostgreSQL-Archiv
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/alembic.ini backend/start.sh ./
COPY backend/alembic ./alembic
COPY backend/app ./app
RUN useradd --system --uid 10001 infrarot && mkdir -p /app/uploads && chown infrarot /app/uploads
USER infrarot
EXPOSE 8000
CMD ["./start.sh"]

# ── Tests (docker build --target test) ──
FROM laufzeit AS test
USER root
COPY backend/requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY backend/tests ./tests
COPY daten ./daten
USER infrarot
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider"]
