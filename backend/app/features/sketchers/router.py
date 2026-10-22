"""
The sketcher page (design doc, item 36): one page per sketcher, at /@username.
Readable by anyone. The sketcher sees more on their own page.

GET /api/sketchers/{username}           the page's header, stats, featured
                                      sketches, kit, usual palette, and for
                                      the sketcher only, admired sketchers
GET /api/sketchers/{username}/sketches  shared sketches, newest first, and for
                                      the sketcher, their sketches in
                                      progress too

A sketch is shared once it has a final sketch (item 30). Feedback from the
critique agent is only ever sent to the sketcher who owns it. Follower
counts, likes and comments come from features/community.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth import get_optional_sketcher_id
from app.core.database import get_db
from app.core.models import KitItem, Profile, Sketch, SketchComment, SketchLike
from app.features.community.router import follow_counts, is_following
from app.features.kit.router import KIND_ORDER, _to_dict as kit_item_to_dict
from app.features.persona.router import admired_list, admired_to_dict
from app.features.sketches.router import _sketch_card, card_query
from app.core.visibility import visible_filter

router = APIRouter(prefix="/api", tags=["sketchers"])

MAX_FEATURED = 5


def _profile_by_username(db: Session, username: str) -> Profile:
    profile = db.query(Profile).filter(Profile.username == username.strip().lstrip("@").lower()).first()
    if profile is None:
        raise HTTPException(404, "Sketcher not found")
    return profile


def _city(location_label: str | None) -> str | None:
    """The city part of a place name: 'Sheung Shui, North District' -> 'North District'."""
    if not location_label:
        return None
    return location_label.split(",")[-1].strip() or None


@router.get("/sketchers/{username}")
def get_sketcher(
    username: str,
    db: Session = Depends(get_db),
    viewer_id: str | None = Depends(get_optional_sketcher_id),
):
    profile = _profile_by_username(db, username)
    is_owner = viewer_id == profile.id

    shared = (
        card_query(db)
        .filter(Sketch.sketcher_id == profile.id, visible_filter(viewer_id))
        .all()
    )
    by_id = {s.id: s for s in shared}
    featured = [by_id[i] for i in (profile.featured_sketch_ids or []) if i in by_id][:MAX_FEATURED]

    kit_rows = db.query(KitItem).filter(KitItem.sketcher_id == profile.id).all()
    if not is_owner:
        kit_rows = [i for i in kit_rows if not i.hidden]
    kit_rows.sort(key=lambda i: (KIND_ORDER.index(i.kind), not i.pinned, i.created_at))

    data = {
        "username": profile.username,
        "display_name": profile.display_name,
        "avatar_url": profile.avatar_url,
        "bio": profile.bio,
        "location": profile.location,
        "links": profile.links or {},
        "is_owner": is_owner,
        "stats": {
            "sketches": len(shared),
            "cities": len({c for c in (_city(s.location_label) for s in shared) if c}),
            **follow_counts(db, profile.id),
        },
        "is_following": is_following(db, viewer_id, profile.id),
        "featured": [_sketch_card(s) for s in featured],
        "kit_photo_url": profile.kit_photo_url,
        "kit": [kit_item_to_dict(i) for i in kit_rows],
        # My favorite palette: paint ids from the paint list (data/paints.js).
        "favorite_paints": profile.favorite_paints or [],
    }
    if is_owner:
        data["admired"] = [admired_to_dict(p) for p in admired_list(db, profile.id)]
    return data


@router.get("/sketchers/{username}/sketches")
def list_sketcher_sketches(
    username: str,
    db: Session = Depends(get_db),
    viewer_id: str | None = Depends(get_optional_sketcher_id),
):
    """Shared sketches, newest first, as cards. The sketcher also gets their
    sketches in progress, each marked `shared: false`."""
    profile = _profile_by_username(db, username)
    is_owner = viewer_id == profile.id
    q = card_query(db).filter(Sketch.sketcher_id == profile.id)
    if not is_owner:
        q = q.filter(visible_filter(viewer_id))
    rows = q.order_by(Sketch.created_at.desc()).all()
    ids = [s.id for s in rows]
    likes = dict(
        db.query(SketchLike.sketch_id, func.count()).filter(SketchLike.sketch_id.in_(ids)).group_by(SketchLike.sketch_id).all()
    ) if ids else {}
    comments = dict(
        db.query(SketchComment.sketch_id, func.count()).filter(SketchComment.sketch_id.in_(ids)).group_by(SketchComment.sketch_id).all()
    ) if ids else {}
    from app.features.sketches.router import upload_counts
    uploads = upload_counts(db, ids) if is_owner else {}
    out = []
    for s in rows:
        d = _sketch_card(s)
        d["shared"] = s.final_sketch_url is not None
        d["upload_count"] = uploads.get(s.id, 0)
        d["place"] = _city(s.location_label)
        d["like_count"] = likes.get(s.id, 0)
        d["comment_count"] = comments.get(s.id, 0)
        out.append(d)
    return out
