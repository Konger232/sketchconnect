"""The home area (decided November 25, 2026): a private place on the
sketcher's profile, with a size (500 m, 1 km or 2 km). A sketch drawn inside
it shows no pin and no place name to anyone but its sketcher: not on the
map, in Explore, in "near here", on cards or on share pages. The location is
kept, so the sketcher's own map still works.

sketches.location_hidden holds the answer for each sketch, so every list
can filter with one column. refresh() sets it: when the home area changes
(all the sketcher's sketches, old ones too) and when a sketch's location is
set or changed.
"""
from sqlalchemy import or_, text

from app.core.models import Sketch

RADII = (500, 1000, 2000)

_REFRESH = """
update sketches s set location_hidden = coalesce(
    s.location is not null and p.home_location is not null and p.home_radius_m is not null
    and ST_DWithin(s.location, p.home_location, p.home_radius_m), false)
from profiles p
where p.id = s.sketcher_id and s.sketcher_id = cast(:sid as uuid)
"""


def refresh(db, sketcher_id: str, sketch_id: str | None = None) -> None:
    """Recompute location_hidden for the sketcher's sketches (or one)."""
    if sketch_id:
        db.execute(text(_REFRESH + " and s.id = cast(:id as uuid)"), {"sid": sketcher_id, "id": sketch_id})
    else:
        db.execute(text(_REFRESH), {"sid": sketcher_id})


def hidden_for(s, viewer_id: str | None) -> bool:
    """This sketch's location is hidden from this viewer."""
    return bool(getattr(s, "location_hidden", False)) and viewer_id != s.sketcher_id


def shown(viewer_id: str | None):
    """Filter: sketches whose location this viewer may see."""
    open_ = Sketch.location_hidden.is_(False)
    return or_(open_, Sketch.sketcher_id == viewer_id) if viewer_id else open_
