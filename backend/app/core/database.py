"""
SQLAlchemy engines and sessions, wired to Supabase Postgres via DATABASE_URL.

From Bangkok each round trip to the database (Tokyo) is about 120 ms, so
every trip a request saves counts (October 27, 2026):

  engine       writes (POST, PUT, DELETE): real transactions.
  read_engine  reads (GET): autocommit, so no BEGIN before the first query
               and no ROLLBACK when the connection goes back to the pool,
               two trips saved on every page load. A GET that writes (the
               first /api/profile, which creates the profile) still works;
               each statement just commits on its own.

A connection is checked only after it sat idle a minute (pool_pre_ping
checked on every request, one more trip each time). Idle connections get
dropped somewhere on the way (a home router, a VPN, the pooler), and a new
one costs about 0.6 s, so they are kept alive: TCP keepalives, and a small
background ping (keep_warm) every 45 seconds on the ones not in use.
"""
import time

from fastapi import Request
from sqlalchemy import create_engine, event, exc
from sqlalchemy.orm import sessionmaker, declarative_base

from config import DATABASE_URL, QUERY_LOG

if not DATABASE_URL:
    # Fail loudly at import time in real use, but let tooling (alembic,
    # tests) import this module before .env is filled in.
    import warnings
    warnings.warn("DATABASE_URL is not set — see backend/.env.example")

IDLE_PING_SECONDS = 60

# libpq keepalives: the OS sends a probe on an idle connection, so routers
# and VPNs see traffic and keep it open.
_KEEPALIVE = ({"keepalives": 1, "keepalives_idle": 30, "keepalives_interval": 10, "keepalives_count": 3}
              if DATABASE_URL.startswith("postgres") else {}) if DATABASE_URL else {}
# Supabase's Session pooler takes a limited number of clients at once, shared
# by every copy of the backend (your Mac and Cloud Run). SQLAlchemy's default
# (5 + 10 overflow per engine, 30 per process) can reach that cap, and new
# connections are then refused. Here: at most 7 reads and 5 writes per process.
engine = (create_engine(DATABASE_URL, pool_recycle=1800, pool_size=2, max_overflow=3, pool_timeout=20,
                        connect_args=_KEEPALIVE) if DATABASE_URL else None)
read_engine = (create_engine(DATABASE_URL, pool_recycle=1800, pool_size=4, max_overflow=3, pool_timeout=20,
                             isolation_level="AUTOCOMMIT", connect_args=_KEEPALIVE)
               if DATABASE_URL else None)
KEEP_WARM_SECONDS = 45


def _tune(eng) -> None:
    @event.listens_for(eng, "checkin")
    def _idle_from(dbapi_conn, record):
        record.info["idle_since"] = time.monotonic()

    @event.listens_for(eng, "checkout")
    def _ping_if_idle(dbapi_conn, record, proxy):
        since = record.info.get("idle_since")
        if since is None or time.monotonic() - since < IDLE_PING_SECONDS:
            return
        try:
            # One trip: autocommit for the ping, so no BEGIN and no ROLLBACK.
            was = dbapi_conn.autocommit
            dbapi_conn.autocommit = True
            cur = dbapi_conn.cursor()
            cur.execute("select 1")
            cur.close()
            dbapi_conn.autocommit = was
        except Exception:
            # The pool drops this connection and opens a new one.
            raise exc.DisconnectionError()
        finally:
            if QUERY_LOG:
                from app.core.querylog import note
                note("pings")

    if QUERY_LOG:
        from app.core.querylog import install
        install(eng)


for _eng in (engine, read_engine):
    if _eng is not None:
        _tune(_eng)

def keep_warm() -> None:
    """Every KEEP_WARM_SECONDS, ping the pooled connections nobody is using,
    so none sits idle long enough to be dropped, and a dropped one is
    replaced here rather than in someone's request. Runs in a thread."""
    from sqlalchemy import text
    last = None  # the last problem printed, so a long outage is one line, not hundreds
    while True:
        time.sleep(KEEP_WARM_SECONDS)
        problem = None
        for eng in (read_engine, engine):
            if eng is None:
                continue
            held = []
            try:
                for _ in range(eng.pool.checkedin()):
                    c = eng.connect()
                    c.execute(text("select 1"))
                    held.append(c)
            except Exception as exc:  # noqa: BLE001 - never stop the loop
                problem = describe_db_error(exc)
            finally:
                for c in held:
                    c.close()
        if problem and problem != last:
            print(f"keep-warm: database not reached: {problem}")
        elif last and not problem:
            print("keep-warm: database reached again")
        last = problem


def describe_db_error(exc: Exception) -> str:
    """The reason a database call failed, in one line: the driver's own
    message (e.g. "Max client connections reached", "could not translate host
    name"). It names the host and user, never the password."""
    inner = getattr(exc, "orig", None) or exc
    lines = [ln.strip() for ln in str(inner).splitlines() if ln.strip()]
    text = next((ln for ln in lines if "FATAL" in ln or "error" in ln.lower()), lines[0] if lines else "")
    return f"{inner.__class__.__name__}: {text[:300]}"


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
ReadSession = sessionmaker(autocommit=False, autoflush=False, bind=read_engine)
Base = declarative_base()


def get_db(request: Request = None):
    """FastAPI dependency: a session for this request, closed after it. GET
    requests read through the autocommit engine."""
    maker = ReadSession if request is not None and request.method == "GET" else SessionLocal
    db = maker()
    try:
        yield db
    finally:
        db.close()
