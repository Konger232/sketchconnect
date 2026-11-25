"""
A sketch's event (design doc, item 49, amended November 25, 2026).

A sketch joins an event by an explicit link, sketches.event_id, not by a
hashtag. Two ways to set it:

- Capture, on the event page: starts a new sketch with the event attached.
  Open from the event's start until 3 days after it ends.
- Link to an event, in Update: attaches a sketch that exists. Open from the
  event's start until 14 days after it ends.

Both are for sketchers who marked Interested (and the organiser). Unlinking is
always allowed for the owner. Kept apart from both routers so the sketches
router can use it without a cycle.
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.models import Event, EventHiddenSketch, EventInterest

CAPTURE_AFTER = timedelta(days=3)  # Capture stays open this long after the event ends
LINK_AFTER = timedelta(days=14)    # Link to an event stays open this long after it ends


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _eligible(db: Session, e: Event, sketcher_id: str) -> bool:
    """Interested, or the organiser."""
    if e.organizer_id == sketcher_id:
        return True
    return db.get(EventInterest, (e.id, sketcher_id)) is not None


def capture_state(e: Event, eligible: bool, signed_in: bool, now: datetime | None = None) -> dict:
    """What the event page's Capture button shows. state is one of
    sign_in | not_interested | opens_later | open | closed."""
    now = now or _now()
    opens, closes = _aware(e.starts_at), _aware(e.ends_at) + CAPTURE_AFTER
    if not signed_in:
        state = "sign_in"
    elif not eligible:
        state = "not_interested"
    elif now < opens:
        state = "opens_later"
    elif now > closes:
        state = "closed"
    else:
        state = "open"
    return {"state": state, "opens_at": opens, "closes_at": closes,
            "link_until": _aware(e.ends_at) + LINK_AFTER}


def event_for_link(db: Session, event_id: str, sketcher_id: str, window: timedelta, what: str) -> Event:
    """The event a sketch may be attached to now, or an HTTPException that
    says why not. `what` is "start a sketch at" or "link a sketch to"."""
    e = db.get(Event, event_id)
    if e is None or (e.hidden and e.organizer_id != sketcher_id):
        raise HTTPException(404, "Event not found")
    if not _eligible(db, e, sketcher_id):
        raise HTTPException(403, f"Mark Interested first, then you can {what} this event.")
    now = _now()
    if now < _aware(e.starts_at):
        raise HTTPException(409, "This event hasn't started yet.")
    if now > _aware(e.ends_at) + window:
        raise HTTPException(409, f"This event ended too long ago to {what}.")
    return e


def unlink(db: Session, sketch_id: str, event_id: str | None) -> None:
    """Drop the organiser's hide with the link: relinking starts fresh."""
    if event_id:
        db.query(EventHiddenSketch).filter(EventHiddenSketch.event_id == event_id,
                                           EventHiddenSketch.sketch_id == sketch_id).delete()


def attach_events(db: Session, dicts: list[dict]) -> list[dict]:
    """Give each sketch dict its `event`, {id, title} or None, for the
    'Sketched at' chip: one query for all. An event hidden by reports shows
    no chip."""
    ids = {d["event_id"] for d in dicts if d.get("event_id")}
    found = {}
    if ids:
        found = {i: {"id": i, "title": t} for i, t, hidden in
                 db.query(Event.id, Event.title, Event.hidden).filter(Event.id.in_(ids)).all() if not hidden}
    for d in dicts:
        d["event"] = found.get(d.get("event_id"))
    return dicts
