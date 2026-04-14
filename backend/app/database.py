from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.exceptions import DatabaseError

logger = logging.getLogger(__name__)

_engine = None
_SessionLocal = None


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        settings = get_settings()
        try:
            _engine = create_engine(
                settings.database_url,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=10,
            )
            _SessionLocal = sessionmaker(
                autocommit=False, autoflush=False, bind=_engine
            )
        except Exception as e:
            logger.exception("Failed to create database engine")
            raise DatabaseError(f"Database connection failed: {e}") from e
    return _engine


def get_session_factory():
    if _SessionLocal is None:
        get_engine()
    return _SessionLocal


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    factory = get_session_factory()
    if factory is None:
        raise DatabaseError("Session factory not initialized")
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db() -> None:
    """Create tables. Optionally enable pgvector when using Postgres (manual/ops)."""
    from app.config import get_settings

    from app.models.orm import Base

    engine = get_engine()
    settings = get_settings()
    if settings.database_url.startswith("postgresql"):
        try:
            with engine.begin() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        except Exception as e:
            logger.warning("pgvector extension not available (optional): %s", e)
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        logger.exception("init_db failed")
        raise DatabaseError(f"Failed to initialize schema: {e}") from e
