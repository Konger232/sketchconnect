"""
Per-request database numbers, for development (QUERY_LOG=true in
backend/.env). One line per /api request:

  [db] GET /api/events/home 200 - 5 queries, 610 ms in the database, 655 ms in all

Counts every statement SQLAlchemy sends. The number of queries matters more
than their size here: from Bangkok, each one is a round trip to Tokyo.
"""
import contextvars
import time

from sqlalchemy import event

# [queries, seconds in the database] for the current request. Sync routes
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
            stats[0] += 1
            stats[1] += took


class QueryLogMiddleware:
    """Prints each /api request's query count and time."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        stats, status = [0, 0.0], [0]
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
            print(f"[db] {scope['method']} {scope['path']} {status[0]} - {stats[0]} queries, "
                  f"{stats[1] * 1000:.0f} ms in the database, {total:.0f} ms in all", flush=True)
