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
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import get_optional_sketcher_id
from app.core.database import get_db
from app.core.models import KitItem, Profile, Sketch, SketchComment, SketchLike
from app.features.community.router import follow_summary
from app.features.kit.router import _to_dict as kit_item_to_dict, kit_photos, kit_with_wishes
from app.features.paints.router import palette_paints
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

    # Another sketcher sees which of these tools they starred (item 44).
    kit_rows, wished = kit_with_wishes(db, profile.id, viewer_id)
    counts, following = follow_summary(db, viewer_id, profile.id)
    paints = palette_paints(db, profile.id)

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
            **counts,
        },
        "is_following": following,
        "featured": [_sketch_card(s) for s in featured],
        "kit_photo_url": profile.kit_photo_url,
        "kit_photos": kit_photos(profile),
        "kit": [{**kit_item_to_dict(i), "wished": i.id in wished} for i in kit_rows],
        # My palette (palette_items, item 46): the ids, and the paints from
        # the library. The colour recipes mix from these.
        "favorite_paints": [p["id"] for p in paints],
        "palette_paints": paints,
        "palette_layout": profile.palette_layout,
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
    # Likes and comments counted in the same query (each query is a round trip).
    n_likes = (select(func.count()).select_from(SketchLike)
               .where(SketchLike.sketch_id == Sketch.id).correlate(Sketch).scalar_subquery())
    n_comments = (select(func.count()).select_from(SketchComment)
                  .where(SketchComment.sketch_id == Sketch.id).correlate(Sketch).scalar_subquery())
    q = card_query(db, n_likes, n_comments).filter(Sketch.sketcher_id == profile.id)
    if not is_owner:
        q = q.filter(visible_filter(viewer_id))
    rows = q.order_by(Sketch.created_at.desc()).all()
    from app.features.sketches.router import upload_counts
    uploads = upload_counts(db, [s.id for s, _, _ in rows]) if is_owner else {}
    out = []
    for s, likes, comments in rows:
        d = _sketch_card(s)
        d["shared"] = s.final_sketch_url is not None
        d["upload_count"] = uploads.get(s.id, 0)
        d["place"] = _city(s.location_label)
        d["like_count"] = likes or 0
        d["comment_count"] = comments or 0
        out.append(d)
    return out
