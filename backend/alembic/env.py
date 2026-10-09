"""Alembic-Umgebung: Verbindung aus INFRAROT_DATENBANK_URL, Metadaten aus app.models."""
from logging.config import fileConfig

from alembic import context

from app import models  # noqa: F401  (registriert alle Tabellen)
from app.db import Base, engine

if context.config.config_file_name:
    fileConfig(context.config.config_file_name)

with engine().connect() as verbindung:
    context.configure(connection=verbindung, target_metadata=Base.metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()
