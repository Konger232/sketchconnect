"""
The sketcher page (design doc, item 36): one page per sketcher, at /@handle.
Readable by anyone. The sketcher sees more on their own page.

GET /api/sketchers/{handle}           the page's header, stats, featured
                                      sketches, kit, usual palette, and for
                                      the sketcher only, admired sketchers
GET /api/sketchers/{handle}/sketches  shared sketches, newest first, and for
                                      the sketcher, their sketches in
                                      progress too

A sketch is shared once it has a final sketch (item 30). Feedback from the
critique agent is only ever sent to the sketcher who owns it. Followers,
likes and comments join these responses with items 32 and 33.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_optional_sketcher_id
from app.core.database import get_db
from app.core.models import KitItem, Profile, Sketch
from app.features.kit.router import KIND_ORDER, _to_dict as kit_item_to_dict
from app.features.persona.router import admired_list, admired_to_dict
from app.features.sketches.router import _latest_critiques_by_sketch, _sketch_to_dict

router = APIRouter(prefix="/api", tags=["sketchers"])

MAX_FEATURED = 6


def _profile_by_handle(db: Session, handle: str) -> Profile:
    profile = db.query(Profile).filter(Profile.handle == handle.strip().lstrip("@").lower()).first()
    if profile is None:
        raise HTTPException(404, "Sketcher not found")
    return profile


def _city(location_label: str | None) -> str | None:
    """The city part of a place name: 'Sheung Shui, North District' -> 'North District'."""
    if not location_label:
        return None
    return location_label.split(",")[-1].strip() or None


@router.get("/sketchers/{handle}")
async def get_sketcher(
    handle: str,
    db: Session = Depends(get_db),
    viewer_id: str | None = Depends(get_optional_sketcher_id),
):
    profile = _profile_by_handle(db, handle)
    is_owner = viewer_id == profile.id

    shared = (
        db.query(Sketch)
        .filter(Sketch.sketcher_id == profile.id, Sketch.final_sketch_url.isnot(None))
        .all()
    )
    by_id = {s.id: s for s in shared}
    featured = [by_id[i] for i in (profile.featured_sketch_ids or []) if i in by_id][:MAX_FEATURED]

    kit_rows = db.query(KitItem).filter(KitItem.sketcher_id == profile.id).all()
    if not is_owner:
        kit_rows = [i for i in kit_rows if not i.hidden]
    kit_rows.sort(key=lambda i: (KIND_ORDER.index(i.kind), not i.pinned, i.created_at))
    # My usual palette: the paints the sketcher pinned. Counting how often
    # each paint appears in their sketches comes with palettes (item 28).
    usual_palette = [kit_item_to_dict(i) for i in kit_rows if i.kind == "color" and i.pinned and not i.hidden]

    data = {
        "handle": profile.handle,
        "display_name": profile.display_name,
        "avatar_url": profile.avatar_url,
        "bio": profile.bio,
        "location": profile.location,
        "links": profile.links or {},
        "is_owner": is_owner,
        "stats": {
            "sketches": len(shared),
            "cities": len({c for c in (_city(s.location_label) for s in shared) if c}),
        },
        "featured": [_sketch_to_dict(s) for s in featured],
        "kit_photo_url": profile.kit_photo_url,
        "kit": [kit_item_to_dict(i) for i in kit_rows],
        "usual_palette": usual_palette,
    }
    if is_owner:
        data["admired"] = [admired_to_dict(p) for p in admired_list(db, profile.id)]
    return data


@router.get("/sketchers/{handle}/sketches")
async def list_sketcher_sketches(
    handle: str,
    db: Session = Depends(get_db),
    viewer_id: str | None = Depends(get_optional_sketcher_id),
):
    """Shared sketches, newest first. The sketcher also gets their sketches
    in progress, each marked `shared: false`, and their feedback text."""
    profile = _profile_by_handle(db, handle)
    is_owner = viewer_id == profile.id
    q = db.query(Sketch).filter(Sketch.sketcher_id == profile.id)
    if not is_owner:
        q = q.filter(Sketch.final_sketch_url.isnot(None))
    rows = q.order_by(Sketch.created_at.desc()).all()
    latest = _latest_critiques_by_sketch(db, [s.id for s in rows]) if is_owner else {}
    out = []
    for s in rows:
        d = _sketch_to_dict(s, latest.get(s.id))
        d["shared"] = s.final_sketch_url is not None
        out.append(d)
    return out
