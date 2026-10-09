"""Datenbankverbindung und Sitzungen."""
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import einstellungen


class Base(DeclarativeBase):
    pass


@lru_cache
def engine() -> Engine:
    return create_engine(einstellungen().datenbank_url, pool_pre_ping=True)


@lru_cache
def sitzungsfabrik() -> sessionmaker[Session]:
    return sessionmaker(bind=engine(), expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with sitzungsfabrik()() as db:
        yield db
