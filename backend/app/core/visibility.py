"""
Who can see a sketch (design doc: protecting sketchers' work, October 22,
2026). A sketch is the owner's alone until it has a final sketch. Once
shared, the owner picks who sees it:

  members    every signed-in sketcher (the default); visitors see a teaser
             of the final on the visitor Home
  followers  only sketchers who follow the owner
  private    only the owner

One set of rules for every list and page: visible_filter() for queries,
can_see() for one sketch.
"""
from sqlalchemy import and_, exists, or_

from app.core.models import Follow, Sketch

VISIBILITIES = ("members", "followers", "private")


def _follows(viewer_id: str):
    return exists().where(Follow.follower_id == viewer_id, Follow.followed_id == Sketch.sketcher_id).correlate(Sketch)


def visible_filter(viewer_id: str | None, own_drafts: bool = False):
    """A filter for lists of sketches. Shared sketches the viewer may see,
    and the viewer's own shared ones; with own_drafts, their drafts too (the
    Sketcher page). A visitor (no viewer) gets members-only sketches, for
    the teaser feed."""
    shared = Sketch.final_sketch_url.isnot(None)
    members = Sketch.visibility == "members"
    if not viewer_id:
        return and_(shared, members)
    mine = Sketch.sketcher_id == viewer_id
    others = and_(shared, or_(members, and_(Sketch.visibility == "followers", _follows(viewer_id))))
    return or_(mine if own_drafts else and_(shared, mine), others)


def can_see(db, sketch: Sketch, viewer_id: str | None) -> bool:
    """One sketch: the owner always; others by its visibility, once shared."""
    if viewer_id and viewer_id == sketch.sketcher_id:
        return True
    if not sketch.final_sketch_url:
        return False
    v = sketch.visibility or "members"
    if v == "members":
        return True
    if v == "followers" and viewer_id:
        return db.get(Follow, (viewer_id, sketch.sketcher_id)) is not None
    return False
