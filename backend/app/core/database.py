"""
SQLAlchemy engine/session wired to Supabase Postgres via DATABASE_URL.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from config import DATABASE_URL

if not DATABASE_URL:
    # Fail loudly at import time in real use, but let tooling (alembic,
    # tests) import this module before .env is filled in.
    import warnings
    warnings.warn("DATABASE_URL is not set — see backend/.env.example")

engine = create_engine(DATABASE_URL, pool_pre_ping=True) if DATABASE_URL else None
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency: yields a session, closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
