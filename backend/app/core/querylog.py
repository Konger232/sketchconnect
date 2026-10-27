"""
Per-request database numbers, for development (QUERY_LOG=true in
backend/.env). One line per /api request:

  [db] GET /api/events/home 200 - 5 queries, 610 ms in the database, 655 ms in all

plus, when they happen, the idle-connection checks and new connections
(each new one is a TLS handshake: several round trips).

Counts every statement SQLAlchemy sends. The number of queries matters more
than their size here: from Bangkok, each one is a round trip to Tokyo.
"""
import contextvars
import time

from sqlalchemy import event

# {queries, seconds, pings, connects} for the current request. Sync routes
# run in a thread with a copy of this context, so they add to the same list.
_stats: contextvars.ContextVar = contextvars.ContextVar("query_stats", default=None)


def install(engine) -> None:
    @event.listens_for(engine, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):
        conn.info.setdefault("query_started", []).append(time.perf_counter())

    @event.listens_for(engine, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):
        took = time.perf_counter() - conn.info["query_started"].pop()
        stats = _stats.get()
        if stats is not None:
            stats["queries"] += 1
            stats["seconds"] += took

    @event.listens_for(engine, "connect")
    def _connected(dbapi_conn, record):
        note("connects")


def note(kind: str) -> None:
    stats = _stats.get()
    if stats is not None:
        stats[kind] += 1


class QueryLogMiddleware:
    """Prints each /api request's query count and time."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        stats, status = {"queries": 0, "seconds": 0.0, "pings": 0, "connects": 0}, [0]
        token = _stats.set(stats)
        started = time.perf_counter()

        async def send_and_note(message):
            if message["type"] == "http.response.start":
                status[0] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_and_note)
        finally:
            _stats.reset(token)
            total = (time.perf_counter() - started) * 1000
            extra = "".join(f", {stats[k]} {k[:-1] if stats[k] == 1 else k}" for k in ("pings", "connects") if stats[k])
            print(f"[db] {scope['method']} {scope['path']} {status[0]} - {stats['queries']} queries, "
                  f"{stats['seconds'] * 1000:.0f} ms in the database, {total:.0f} ms in all{extra}", flush=True)
