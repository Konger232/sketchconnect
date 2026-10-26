"""
Hashtags in a sketch's title and field notes (design doc, item 49): a
sketch joins an event when it carries the event's hashtag. Kept apart from
the router so the sketches router can call sync_tags without a cycle.
"""
import re

from sqlalchemy.orm import Session

from app.core.models import Sketch, SketchTag

TAG = re.compile(r"(?<![\w#])#([A-Za-z0-9_]{2,40})")
HASHTAG = re.compile(r"^[A-Za-z0-9_]{3,40}$")  # an event's own tag, without the #


def tags_in(*texts: str | None) -> set[str]:
    """'#UskBkkOct26 at #Ari' -> {'uskbkkoct26', 'ari'}"""
    return {m.lower() for t in texts if t for m in TAG.findall(t)}


def sync_tags(db: Session, sketch: Sketch) -> None:
    """Make sketch_tags match the hashtags now in the title and notes."""
    want = tags_in(sketch.title, sketch.field_notes)
    have = {t for (t,) in db.query(SketchTag.tag).filter(SketchTag.sketch_id == sketch.id).all()}
    for t in have - want:
        db.query(SketchTag).filter(SketchTag.sketch_id == sketch.id, SketchTag.tag == t).delete()
    for t in want - have:
        db.add(SketchTag(sketch_id=sketch.id, tag=t))
