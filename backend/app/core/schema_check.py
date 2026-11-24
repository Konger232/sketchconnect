"""Does the database have every table and column the code needs?

Added November 24, 2026, after a deploy left the site empty for the third
time: new code read a column (sketches.notes_shared) that the SQL at the end
of db/schema.sql adds, and that SQL had not been run in Supabase yet. Every
sketch query then failed, so lists came back empty.

check() compares the models (app/core/models.py) with the database's
information_schema in one query. The result is printed loudly at startup
(the Cloud Run log) and shown on /health, so a missing column is named
instead of showing as "no data".
"""
from sqlalchemy import text

# None: not checked yet (or no database). [] : all there. Otherwise the
# missing "table" or "table.column" names.
MISSING: list[str] | None = None


def check(engine) -> list[str] | None:
    global MISSING
    if engine is None:
        return None
    from app.core import models  # noqa: F401 - registers every table
    from app.core.database import Base

    want = {t.name: {c.name for c in t.columns}
            for t in Base.metadata.tables.values() if t.schema in (None, "public")}
    with engine.connect() as conn:
        rows = conn.execute(text(
            "select table_name, column_name from information_schema.columns "
            "where table_schema = 'public' and table_name = any(:names)"),
            {"names": list(want)}).all()
    have: dict[str, set[str]] = {}
    for table, column in rows:
        have.setdefault(table, set()).add(column)
    missing = []
    for table, columns in sorted(want.items()):
        if table not in have:
            missing.append(table)
        else:
            missing += [f"{table}.{c}" for c in sorted(columns - have[table])]
    MISSING = missing
    return missing


def report(engine) -> None:
    """Check, and print the result for the log. Never raises."""
    try:
        missing = check(engine)
    except Exception as exc:  # noqa: BLE001 - a check must never stop the server
        from app.core.database import describe_db_error
        print(f"schema check: not run ({describe_db_error(exc)})")
        return
    if missing is None:
        return
    if not missing:
        print("schema check: ok, every table and column the code needs is in the database")
        return
    line = "!" * 72
    print(f"{line}\nSCHEMA CHECK: the database is missing {len(missing)} table(s) or column(s) "
          f"the code needs:\n  " + "\n  ".join(missing) +
          "\nRun the new SQL at the end of backend/db/schema.sql in Supabase. "
          "Until then, pages that read these will fail.\n" + line)
