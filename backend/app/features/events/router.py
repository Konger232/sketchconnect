"""
Events (design doc, item 49): casual meet-ups and organised events, always
at a real place, announced and found; no sessions or sign-ups.

Rules (decided October 26, 2026):
- Earn it: 5 completed sketches, a paint collection and a bag, to set one up.
- At most 4 casual meet-ups a month, and 1 organised event at a time.
- Meet-ups stay local: shown within 50 km and in the next 3 months, except to
  the organiser's followers. Organised events show to everyone.
- 3 reports hide an event until it is reviewed.
- An ended event with no tagged sketches drops off the map.
- Featured instructors on SketchConnect appear only once they confirm.
- A sketch joins an event by its hashtag (events/tags.py).

GET    /api/events                     on the map: in a box (south, north, west, east)
GET    /api/events/home                for Home: near me, and my people teaching
GET    /api/events/search?q=           by title, theme, place or hashtag
GET    /api/events/suggest             for the share form: events here and now
GET    /api/events/can-host            the earn-it checklist and the caps
GET    /api/events/invites             instructor requests waiting for me
POST   /api/events                     set one up
GET    /api/events/{id}                the event page
PUT    /api/events/{id}                the organiser edits it
DELETE /api/events/{id}                the organiser removes it
POST   /api/events/{id}/cover          the organiser's cover image
POST   /api/events/{id}/interest       Interested (DELETE: not any more)
POST   /api/events/{id}/report         Report this event
POST   /api/events/{id}/instructors/accept | decline   an invited instructor answers
GET    /api/events/{id}/comments       questions (POST: ask one)
DELETE /api/event-comments/{id}        the author or the organiser
POST   /api/events/{id}/hidden/{sketch_id}   the organiser hides a sketch (DELETE: shows it)
GET    /api/sketchers/{username}/events      teaching and hosting; attending if shown
"""
import io
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from geoalchemy2 import Geometry
from geoalchemy2.elements import WKTElement
from geoalchemy2.shape import to_shape
from PIL import Image, ImageOps
from sqlalchemy import and_, cast, exists, false, func, literal_column, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import get_current_sketcher_id, get_optional_sketcher_id
from app.core.database import get_db
from app.core.models import (Event, EventComment, EventHiddenSketch, EventInstructor, EventInterest, EventReport,
                             Follow, KitItem, Profile, Sketch, SketchLike, SketchTag)
from app.core.paths import UPLOAD_DIR
from app.core.visibility import visible_filter
from app.features.events.schemas import CommentRequest, EventRequest, ReportRequest
from app.features.events.tags import HASHTAG
from app.features.kit.router import kit_photos
from app.features.paints.router import palette_ids
from config import EVENT_RULES_RELAXED

router = APIRouter(prefix="/api", tags=["events"])

MIN_COMPLETED = 5
MEETUPS_PER_MONTH = 4
LOCAL_KM = 50
LOCAL_DAYS = 90  # about 3 months: room to plan a trip
REPORTS_TO_HIDE = 3
SUGGEST_KM = 5


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _point(lat: float, lon: float) -> WKTElement:
    return WKTElement(f"POINT({lon} {lat})", srid=4326)


def person(p: Profile | None) -> dict:
    if p is None:
        return {"display_name": None, "username": None, "avatar_url": None}
    return {"display_name": p.display_name, "username": p.username, "avatar_url": p.avatar_url}


def _follows(db: Session, viewer: str | None) -> set[str]:
    if not viewer:
        return set()
    return {f for (f,) in db.query(Follow.followed_id).filter(Follow.follower_id == viewer).all()}


def _has_sketches(db: Session, event_ids: list[str]) -> set[str]:
    """Events with at least one shared sketch carrying their hashtag."""
    if not event_ids:
        return set()
    rows = (db.query(Event.id)
            .join(SketchTag, SketchTag.tag == func.lower(Event.hashtag))
            .join(Sketch, Sketch.id == SketchTag.sketch_id)
            .filter(Event.id.in_(event_ids), Sketch.final_sketch_url.isnot(None))
            .distinct().all())
    return {i for (i,) in rows}


def event_card(e: Event, organizer: Profile | None = None, interested: int = 0, mine: bool = False) -> dict:
    pt = to_shape(e.location)
    return {
        "id": e.id, "type": e.type, "format": e.format, "title": e.title, "theme": e.theme,
        "hashtag": e.hashtag, "starts_at": _aware(e.starts_at), "ends_at": _aware(e.ends_at), "time_zone": e.time_zone,
        "place_name": e.place_name, "location": {"lat": pt.y, "lon": pt.x, "label": e.place_name},
        "cover_image_url": e.cover_image_url, "org_name": e.org_name,
        "organizer": person(organizer), "interested_count": interested, "is_interested": mine,
    }


def _cards(db: Session, events: list[Event], viewer: str | None) -> list[dict]:
    """Cards for a list of events, in one query: each event's organiser,
    how many are interested, and whether the viewer is."""
    ids = [e.id for e in events]
    if not ids:
        return []
    is_mine = (func.coalesce(func.bool_or(EventInterest.sketcher_id == viewer), False) if viewer else false())
    rows = (db.query(Event.id, Profile, func.count(EventInterest.sketcher_id), is_mine)
            .select_from(Event)
            .outerjoin(Profile, Profile.id == Event.organizer_id)
            .outerjoin(EventInterest, EventInterest.event_id == Event.id)
            .filter(Event.id.in_(ids))
            .group_by(Event.id, Profile.id).all())
    info = {eid: (org, n, bool(mine)) for eid, org, n, mine in rows}
    return [event_card(e, *info.get(e.id, (None, 0, False))) for e in events]


def _reach(db: Session, viewer: str | None, near: tuple[float, float] | None, followed: set[str] | None = None):
    """Who sees which events (the local-reach rule): organised events
    everywhere; meet-ups nearby and soon, or anywhere to the organiser's
    followers and the organiser."""
    now = _now()
    soon = and_(Event.starts_at <= now + timedelta(days=LOCAL_DAYS))
    local = [Event.type == "organised"]
    if near:
        local.append(and_(Event.type == "meetup", soon,
                          func.ST_DWithin(Event.location, _point(*near), LOCAL_KM * 1000)))
    if viewer:
        local.append(Event.organizer_id == viewer)
        followed = _follows(db, viewer) if followed is None else followed
        if followed:
            local.append(Event.organizer_id.in_(followed))
    return and_(Event.hidden.is_(False), or_(*local))


def _drop_empty_past(db: Session, events: list[Event]) -> list[Event]:
    """An event that has ended stays only if sketches carry its hashtag."""
    now = _now()
    past = [e.id for e in events if _aware(e.ends_at) < now]
    keep = _has_sketches(db, past)
    return [e for e in events if _aware(e.ends_at) >= now or e.id in keep]


# ---- finding sketchers (the featured instructors field) ----

@router.get("/sketcher-lookup")
def sketcher_lookup(q: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    """Up to 8 sketchers whose username or name matches, usernames that
    start with the text first."""
    text = q.strip().lstrip("@")
    if len(text) < 2:
        return []
    like = f"%{text}%"
    rows = (db.query(Profile).filter(Profile.username.isnot(None))
            .filter(or_(Profile.username.ilike(like), Profile.display_name.ilike(like)))
            .order_by(Profile.username.ilike(f"{text}%").desc(), Profile.username).limit(8).all())
    return [person(p) for p in rows]


# ---- finding events ----

@router.get("/events")
def events_in_view(south: float, north: float, west: float, east: float,
                   near_lat: float | None = None, near_lon: float | None = None,
                   db: Session = Depends(get_db), viewer: str | None = Depends(get_optional_sketcher_id)):
    """The map: upcoming events in the box, by the reach rule. "Near" is the
    map's centre, so a sketcher planning a trip sees the meet-ups there."""
    near = (near_lat, near_lon) if near_lat is not None and near_lon is not None else ((south + north) / 2, (west + east) / 2)
    geom = cast(Event.location, Geometry(srid=4326))
    rows = (db.query(Event)
            .filter(_reach(db, viewer, near))
            .filter(func.ST_Intersects(geom, func.ST_MakeEnvelope(west, south, east, north, 4326)))
            .filter(Event.ends_at >= _now())  # upcoming only, for this release
            .order_by(Event.starts_at.asc()).limit(200).all())
    return _cards(db, rows, viewer)


@router.get("/events/home")
def events_for_home(lat: float | None = None, lon: float | None = None,
                    db: Session = Depends(get_db), viewer: str | None = Depends(get_optional_sketcher_id)):
    """The Events page in one call: your own events (upcoming, and the last
    12 past, for you only); upcoming events, nearest first when the location
    is known; and events where someone you follow or whose sketches you
    liked is a confirmed featured instructor. Five queries: each one is a
    round trip to the database (about 120 ms from Bangkok to Tokyo in dev)."""
    now = _now()
    near = (lat, lon) if lat is not None and lon is not None else None
    # Who you follow and whose sketches you liked, in one query.
    followed, liked = set(), set()
    if viewer:
        kinds = (db.query(literal_column("'f'").label("k"), Follow.followed_id.label("p")).filter(Follow.follower_id == viewer)
                 .union_all(db.query(literal_column("'l'").label("k"), Sketch.sketcher_id.label("p"))
                            .join(SketchLike, SketchLike.sketch_id == Sketch.id)
                            .filter(SketchLike.sketcher_id == viewer)).all())
        followed = {p for k, p in kinds if k == "f"}
        liked = {p for k, p in kinds if k == "l"}

    q = db.query(Event).filter(_reach(db, viewer, near, followed), Event.ends_at >= now)
    if viewer:
        q = q.filter(Event.organizer_id != viewer)  # yours have their own section
    q = q.order_by(func.ST_Distance(Event.location, _point(*near)), Event.starts_at) if near else q.order_by(Event.starts_at)
    upcoming = q.limit(12).all()

    ahead, past, teach_rows = [], [], []
    if viewer:
        # Yours, in one query: coming up first, then the most recent past.
        own = db.query(Event).filter(Event.organizer_id == viewer).order_by(Event.starts_at).all()
        ahead = [e for e in own if _aware(e.ends_at) >= now]
        past = sorted((e for e in own if _aware(e.ends_at) < now), key=lambda e: e.starts_at, reverse=True)[:12]

        people = (followed | liked) - {viewer}
        if people:
            teach_rows = (db.query(Event, Profile)
                          .join(EventInstructor, EventInstructor.event_id == Event.id)
                          .outerjoin(Profile, Profile.id == EventInstructor.sketcher_id)
                          .filter(EventInstructor.sketcher_id.in_(people), EventInstructor.status == "confirmed",
                                  Event.hidden.is_(False), Event.ends_at >= now)
                          .order_by(Event.starts_at).limit(12).all())

    # One card query for every event on the page.
    every = {e.id: e for e in [*upcoming, *ahead, *past, *(e for e, _ in teach_rows)]}
    cards = {c["id"]: c for c in _cards(db, list(every.values()), viewer)}
    return {
        "mine": [cards[e.id] for e in ahead],
        "mine_past": [cards[e.id] for e in past],
        "upcoming": [cards[e.id] for e in upcoming],
        "teaching": [{**cards[e.id], "instructor": person(p)} for e, p in teach_rows],
    }


@router.get("/events/search")
def search_events(q: str, db: Session = Depends(get_db), viewer: str | None = Depends(get_optional_sketcher_id)):
    text = q.strip().lstrip("#")
    if len(text) < 2:
        return []
    like = f"%{text}%"
    rows = (db.query(Event)
            .filter(Event.hidden.is_(False), Event.ends_at >= _now())  # upcoming only, for this release
            .filter(or_(Event.title.ilike(like), Event.theme.ilike(like), Event.place_name.ilike(like),
                        Event.hashtag.ilike(like), Event.org_name.ilike(like)))
            .order_by(Event.starts_at.asc()).limit(30).all())
    return _cards(db, rows, viewer)


@router.get("/events/suggest")
def suggest_for_sketch(lat: float, lon: float, at: datetime | None = None,
                       db: Session = Depends(get_db), viewer: str | None = Depends(get_optional_sketcher_id)):
    """The share form: events under way here and now (a day either side),
    so the sketcher can add the hashtag without remembering it."""
    when = _aware(at) if at else _now()
    rows = (db.query(Event)
            .filter(Event.hidden.is_(False),
                    Event.starts_at <= when + timedelta(days=1), Event.ends_at >= when - timedelta(days=1),
                    func.ST_DWithin(Event.location, _point(lat, lon), SUGGEST_KM * 1000))
            .order_by(Event.starts_at).limit(5).all())
    return _cards(db, rows, viewer)


# ---- setting one up ----

def _checklist(db: Session, me: str) -> dict:
    completed = db.query(func.count()).select_from(Sketch).filter(
        Sketch.sketcher_id == me, Sketch.final_sketch_url.isnot(None)).scalar()
    profile = db.get(Profile, me)
    bag = bool(kit_photos(profile)) or db.query(KitItem.id).filter(KitItem.sketcher_id == me).first() is not None
    palette = bool(palette_ids(db, me))
    return {"completed_sketches": completed, "needed_sketches": MIN_COMPLETED,
            "has_palette": palette, "has_bag": bag, "relaxed": EVENT_RULES_RELAXED,
            # RELAXED_EVENT_RULES=true (testing): no earn-it rule (config.py).
            "earned": EVENT_RULES_RELAXED or (completed >= MIN_COMPLETED and palette and bag)}


@router.get("/events/can-host")
def can_host(db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    c = _checklist(db, me)
    now = _now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    crawls = db.query(func.count()).select_from(Event).filter(
        Event.organizer_id == me, Event.type == "meetup", Event.starts_at >= month_start).scalar()
    open_org = db.query(Event.id).filter(Event.organizer_id == me, Event.type == "organised", Event.ends_at >= now).first()
    return {**c, "meetups_this_month": crawls, "meetups_per_month": MEETUPS_PER_MONTH,
            "organised_open": open_org is not None}


def _clean_url(u: str | None) -> str | None:
    u = (u or "").strip()
    if not u:
        return None
    if not u.lower().startswith(("http://", "https://")):
        u = "https://" + u
    return u


def _check_caps(db: Session, me: str, body: EventRequest, exclude: str | None = None) -> None:
    if EVENT_RULES_RELAXED:
        return  # testing: no limits (config.py)
    starts = _aware(body.starts_at)
    if body.type == "meetup":
        m0 = starts.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        m1 = (m0 + timedelta(days=32)).replace(day=1)
        q = db.query(func.count()).select_from(Event).filter(
            Event.organizer_id == me, Event.type == "meetup", Event.starts_at >= m0, Event.starts_at < m1)
        if exclude:
            q = q.filter(Event.id != exclude)
        if q.scalar() >= MEETUPS_PER_MONTH:
            raise HTTPException(422, f"You can set up at most {MEETUPS_PER_MONTH} casual meet-ups a month.")
    else:
        q = db.query(Event.id).filter(Event.organizer_id == me, Event.type == "organised", Event.ends_at >= _now())
        if exclude:
            q = q.filter(Event.id != exclude)
        if q.first():
            raise HTTPException(422, "You have an organised event coming up. You can set up the next one once it has ended.")


def _apply(db: Session, e: Event, body: EventRequest, me: str) -> None:
    tag = body.hashtag.strip().lstrip("#")
    if not HASHTAG.match(tag):
        raise HTTPException(422, "A hashtag is 3 to 40 letters, numbers or _, with no spaces.")
    taken = db.query(Event.id).filter(func.lower(Event.hashtag) == tag.lower(), Event.id != (e.id or "")).first()
    if taken:
        raise HTTPException(409, f"#{tag} is taken. Try another.")
    if _aware(body.ends_at) < _aware(body.starts_at):
        raise HTTPException(422, "The event ends before it starts.")
    e.type = body.type
    e.format = body.format  # any format for either type: chapters call 3-day festivals sketch crawls
    e.title = " ".join(body.title.split())
    e.description = (body.description or "").strip() or None
    e.theme = (body.theme or "").strip() or None
    e.hashtag = tag
    e.starts_at, e.ends_at = _aware(body.starts_at), _aware(body.ends_at)
    e.time_zone = body.time_zone or "UTC"
    e.place_name = body.place_name.strip()
    e.location = _point(body.lat, body.lon)
    e.spot_id = body.spot_id
    organised = body.type == "organised"
    e.org_name = (body.org_name or "").strip() or None if organised else None
    e.org_url = _clean_url(body.org_url) if organised else None
    e.website_url = _clean_url(body.website_url) if organised else None
    e.ticket_url = _clean_url(body.ticket_url) if organised else None


def _set_instructors(db: Session, e: Event, body: EventRequest) -> None:
    """Organised events only. A sketcher is invited and appears once they
    confirm; one already confirmed stays confirmed."""
    if e.type != "organised":
        db.query(EventInstructor).filter(EventInstructor.event_id == e.id).delete()
        return
    old = {i.sketcher_id: i for i in db.query(EventInstructor).filter(EventInstructor.event_id == e.id).all() if i.sketcher_id}
    db.query(EventInstructor).filter(EventInstructor.event_id == e.id, EventInstructor.sketcher_id.is_(None)).delete()
    keep = set()
    for pos, i in enumerate(body.instructors):
        if i.username:
            p = db.query(Profile).filter(func.lower(Profile.username) == i.username.strip().lstrip("@").lower()).first()
            if not p:
                raise HTTPException(422, f"No sketcher @{i.username.strip().lstrip('@')}.")
            keep.add(p.id)
            if p.id in old:
                old[p.id].position = pos
            else:
                db.add(EventInstructor(event_id=e.id, sketcher_id=p.id, status="invited", position=pos))
        elif (i.name or "").strip():
            db.add(EventInstructor(event_id=e.id, name=i.name.strip(), status="confirmed", position=pos))
    for sid, row in old.items():
        if sid not in keep:
            db.delete(row)


@router.post("/events")
def create_event(body: EventRequest, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    c = _checklist(db, me)
    if not c["earned"]:
        raise HTTPException(403, "Setting up an event needs 5 completed sketches, a paint collection and a bag.")
    _check_caps(db, me, body)
    e = Event(id=str(uuid.uuid4()), organizer_id=me)
    _apply(db, e, body, me)
    db.add(e)
    db.flush()
    _set_instructors(db, e, body)
    db.commit()
    return event_page(e.id, db, me)


def _mine(db: Session, event_id: str, me: str) -> Event:
    e = db.get(Event, event_id)
    if e is None or e.organizer_id != me:
        raise HTTPException(404, "Event not found")
    return e


@router.put("/events/{event_id}")
def update_event(event_id: str, body: EventRequest, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    e = _mine(db, event_id, me)
    if body.type != e.type or _aware(body.starts_at) != _aware(e.starts_at):
        _check_caps(db, me, body, exclude=e.id)
    _apply(db, e, body, me)
    _set_instructors(db, e, body)
    db.commit()
    return event_page(e.id, db, me)


@router.delete("/events/{event_id}")
def delete_event(event_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    e = _mine(db, event_id, me)
    for model in (EventInstructor, EventInterest, EventReport, EventComment, EventHiddenSketch):
        db.query(model).filter(model.event_id == e.id).delete()
    db.delete(e)
    db.commit()
    return {"deleted": True}


@router.post("/events/{event_id}/cover")
async def set_cover(event_id: str, image: UploadFile = File(...), db: Session = Depends(get_db),
                    me: str = Depends(get_current_sketcher_id)):
    e = _mine(db, event_id, me)
    try:
        pil = ImageOps.exif_transpose(Image.open(io.BytesIO(await image.read()))).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not read that image")
    pil.thumbnail((2000, 2000))
    name = f"event_{uuid.uuid4()}.jpg"
    pil.save(UPLOAD_DIR / name, format="JPEG", quality=86)
    e.cover_image_url = f"/uploads/{name}"
    db.commit()
    return {"cover_image_url": e.cover_image_url}


# ---- the event page ----

@router.get("/events/{event_id}")
def event_page(event_id: str, db: Session = Depends(get_db), viewer: str | None = Depends(get_optional_sketcher_id)):
    try:
        uuid.UUID(event_id)
    except ValueError:
        raise HTTPException(404, "Event not found")
    # The event and whether I reported it: one query.
    reported_q = (exists().where(EventReport.event_id == Event.id, EventReport.sketcher_id == viewer)
                  if viewer else false())
    found = db.query(Event, reported_q).filter(Event.id == event_id).first()
    e, reported = found if found else (None, False)
    if e is None or (e.hidden and e.organizer_id != viewer):
        raise HTTPException(404, "Event not found")
    is_org = viewer == e.organizer_id
    card = _cards(db, [e], viewer)[0]

    # The instructors with their profiles: one query.
    instructors = []
    for r, p in (db.query(EventInstructor, Profile)
                 .outerjoin(Profile, Profile.id == EventInstructor.sketcher_id)
                 .filter(EventInstructor.event_id == e.id).order_by(EventInstructor.position).all()):
        if r.sketcher_id and r.status != "confirmed" and not is_org and r.sketcher_id != viewer:
            continue
        instructors.append({"id": r.id, "status": r.status, "name": r.name,
                            "sketcher": person(p) if r.sketcher_id else None,
                            "is_me": bool(viewer and r.sketcher_id == viewer)})

    # Sketchers I follow who are interested, named only if they show it.
    friends = []
    if viewer:
        followed = select(Follow.followed_id).where(Follow.follower_id == viewer)
        friends = [person(p) for p in db.query(Profile).join(EventInterest, EventInterest.sketcher_id == Profile.id)
                   .filter(EventInterest.event_id == e.id, Profile.id.in_(followed),
                           Profile.show_attending_events.is_(True)).limit(12).all()]

    return {
        **card, "description": e.description,
        "org_url": e.org_url, "website_url": e.website_url, "ticket_url": e.ticket_url, "spot_id": e.spot_id,
        "instructors": instructors, "friends_interested": friends,
        "is_organizer": is_org, "reported": bool(reported), "hidden": e.hidden,
        "sketches": event_sketches(db, e, viewer),
    }


def event_sketches(db: Session, e: Event, viewer: str | None) -> list[dict]:
    """The participants' work: shared sketches carrying the hashtag, newest
    first; the organiser's hidden ones only to the organiser, marked."""
    from app.features.sketches.router import _with_owners, card_query  # the sketches router imports events/tags
    # Whether the organiser hid each one, in the same query.
    hidden_q = exists().where(EventHiddenSketch.event_id == e.id, EventHiddenSketch.sketch_id == Sketch.id)
    rows = (card_query(db, hidden_q).join(SketchTag, SketchTag.sketch_id == Sketch.id)
            .filter(SketchTag.tag == e.hashtag.lower(), visible_filter(viewer), Sketch.final_sketch_url.isnot(None))
            .order_by(Sketch.created_at.desc()).limit(200).all())
    is_org = viewer == e.organizer_id
    rows = [(s, h) for s, h in rows if is_org or not h]
    hidden = {s.id for s, h in rows if h}
    cards = _with_owners(db, [s for s, _ in rows], viewer)
    for c in cards:
        c["hidden_from_event"] = c["id"] in hidden
    return cards


@router.post("/events/{event_id}/interest")
def interested(event_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    """Add my interest and return the new count, in one statement."""
    _uuid_or_404(event_id)
    try:
        n = db.execute(text("""
            with ins as (
              insert into event_interest (event_id, sketcher_id) values (:e, :me)
              on conflict do nothing returning 1)
            select (select count(*) from event_interest where event_id = :e) + (select count(*) from ins)
        """), {"e": event_id, "me": me}).scalar()
        db.commit()
    except IntegrityError:  # no such event
        db.rollback()
        raise HTTPException(404, "Event not found")
    return {"interested_count": n, "is_interested": True}


@router.delete("/events/{event_id}/interest")
def not_interested(event_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    """Remove my interest and return the new count, in one statement."""
    _uuid_or_404(event_id)
    n = db.execute(text("""
        with del as (
          delete from event_interest where event_id = :e and sketcher_id = :me returning 1)
        select (select count(*) from event_interest where event_id = :e) - (select count(*) from del)
    """), {"e": event_id, "me": me}).scalar()
    db.commit()
    return {"interested_count": n, "is_interested": False}


def _uuid_or_404(event_id: str) -> None:
    try:
        uuid.UUID(event_id)
    except ValueError:
        raise HTTPException(404, "Event not found")


@router.post("/events/{event_id}/report")
def report_event(event_id: str, body: ReportRequest, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    e = db.get(Event, event_id)
    if e is None:
        raise HTTPException(404, "Event not found")
    if e.organizer_id == me:
        raise HTTPException(422, "You can't report your own event.")
    if not db.get(EventReport, (event_id, me)):
        db.add(EventReport(event_id=event_id, sketcher_id=me, reason=(body.reason or "").strip() or None))
        db.flush()
    n = db.query(func.count()).select_from(EventReport).filter(EventReport.event_id == event_id).scalar()
    if n >= REPORTS_TO_HIDE:
        e.hidden = True
    db.commit()
    return {"reported": True}


@router.get("/events/invites/mine")
def my_invites(db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    rows = (db.query(Event).join(EventInstructor, EventInstructor.event_id == Event.id)
            .filter(EventInstructor.sketcher_id == me, EventInstructor.status == "invited", Event.ends_at >= _now())
            .order_by(Event.starts_at).all())
    return _cards(db, rows, me)


def _answer(db: Session, event_id: str, me: str, status: str) -> dict:
    row = db.query(EventInstructor).filter(EventInstructor.event_id == event_id, EventInstructor.sketcher_id == me).first()
    if row is None:
        raise HTTPException(404, "No invitation")
    row.status = status
    db.commit()
    return {"status": status}


@router.post("/events/{event_id}/instructors/accept")
def accept(event_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    return _answer(db, event_id, me, "confirmed")


@router.post("/events/{event_id}/instructors/decline")
def decline(event_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    return _answer(db, event_id, me, "declined")


@router.post("/events/{event_id}/hidden/{sketch_id}")
def hide_sketch(event_id: str, sketch_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    _mine(db, event_id, me)
    if not db.get(EventHiddenSketch, (event_id, sketch_id)):
        db.add(EventHiddenSketch(event_id=event_id, sketch_id=sketch_id))
        db.commit()
    return {"hidden": True}


@router.delete("/events/{event_id}/hidden/{sketch_id}")
def show_sketch(event_id: str, sketch_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    _mine(db, event_id, me)
    db.query(EventHiddenSketch).filter(EventHiddenSketch.event_id == event_id, EventHiddenSketch.sketch_id == sketch_id).delete()
    db.commit()
    return {"hidden": False}


# ---- questions (the Comments component) ----

def _comment(c: EventComment, author: Profile | None) -> dict:
    return {"id": c.id, "body": c.body, "created_at": c.created_at, "author_id": c.author_id, "author": person(author)}


@router.get("/events/{event_id}/comments")
def list_comments(event_id: str, db: Session = Depends(get_db)):
    rows = (db.query(EventComment, Profile).outerjoin(Profile, Profile.id == EventComment.author_id)
            .filter(EventComment.event_id == event_id).order_by(EventComment.created_at.asc()).limit(500).all())
    return [_comment(c, p) for c, p in rows]


@router.post("/events/{event_id}/comments")
def add_comment(event_id: str, body: CommentRequest, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    if db.get(Event, event_id) is None:
        raise HTTPException(404, "Event not found")
    text = body.body.strip()
    if not text:
        raise HTTPException(422, "A question needs some words.")
    c = EventComment(event_id=event_id, author_id=me, body=text)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _comment(c, db.get(Profile, me))


@router.delete("/event-comments/{comment_id}")
def delete_comment(comment_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    c = db.get(EventComment, comment_id)
    if c is None:
        raise HTTPException(404, "Comment not found")
    org = db.query(Event.organizer_id).filter(Event.id == c.event_id).scalar()
    if me not in (c.author_id, org):
        raise HTTPException(403, "Only the author or the organiser can remove it")
    db.delete(c)
    db.commit()
    return {"deleted": True}


# ---- on the Sketcher page ----

@router.get("/sketchers/{username}/events")
def sketcher_events(username: str, db: Session = Depends(get_db), viewer: str | None = Depends(get_optional_sketcher_id)):
    """Teaching & hosting (always shown): events they organise or are a
    confirmed instructor at. Attending: events they marked Interested,
    shown to others only when they choose to."""
    p = db.query(Profile).filter(func.lower(Profile.username) == username.lower()).first()
    if p is None:
        raise HTTPException(404, "Sketcher not found")
    since = _now() - timedelta(days=30)
    teach_ids = {i for (i,) in db.query(EventInstructor.event_id).filter(
        EventInstructor.sketcher_id == p.id, EventInstructor.status == "confirmed").all()}
    hosting = (db.query(Event).filter(Event.hidden.is_(False), Event.ends_at >= since,
                                      or_(Event.organizer_id == p.id, Event.id.in_(teach_ids or {""})))
               .order_by(Event.starts_at).limit(20).all())
    cards = _cards(db, hosting, viewer)
    for c, e in zip(cards, hosting):
        c["role"] = "organizer" if e.organizer_id == p.id else "instructor"
    attending = []
    if viewer == p.id or p.show_attending_events:
        rows = (db.query(Event).join(EventInterest, EventInterest.event_id == Event.id)
                .filter(EventInterest.sketcher_id == p.id, Event.hidden.is_(False), Event.ends_at >= _now())
                .order_by(Event.starts_at).limit(20).all())
        attending = _cards(db, rows, viewer)
    return {"hosting": cards, "attending": attending, "show_attending_events": bool(p.show_attending_events)}
