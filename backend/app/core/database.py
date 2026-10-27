"""
SQLAlchemy engine/session wired to Supabase Postgres via DATABASE_URL.
"""
import time

from sqlalchemy import create_engine, event, exc
from sqlalchemy.orm import sessionmaker, declarative_base

from config import DATABASE_URL, QUERY_LOG

if not DATABASE_URL:
    # Fail loudly at import time in real use, but let tooling (alembic,
    # tests) import this module before .env is filled in.
    import warnings
    warnings.warn("DATABASE_URL is not set — see backend/.env.example")

engine = create_engine(DATABASE_URL, pool_recycle=1800) if DATABASE_URL else None

# Check a connection only when it has sat idle a while. pool_pre_ping checked
# on every request, one more round trip each time (about 120 ms from Bangkok
# to Tokyo); a connection used a moment ago is fine.
IDLE_PING_SECONDS = 60

if engine is not None:
    @event.listens_for(engine, "checkin")
    def _idle_from(dbapi_conn, record):
        record.info["idle_since"] = time.monotonic()

    @event.listens_for(engine, "checkout")
    def _ping_if_idle(dbapi_conn, record, proxy):
        since = record.info.get("idle_since")
        if since is None or time.monotonic() - since < IDLE_PING_SECONDS:
            return
        try:
            cur = dbapi_conn.cursor()
            cur.execute("select 1")
            cur.close()
            dbapi_conn.rollback()
        except Exception:
            # The pool drops this connection and opens a new one.
            raise exc.DisconnectionError()

    if QUERY_LOG:
        from app.core.querylog import install
        install(engine)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency: yields a session, closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
