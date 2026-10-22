"""
Sketcher to sketcher (design doc, items 32 and 33): follows, likes and
comments. Signed-in sketchers ("members") can do all three; anyone can read
counts and comments on shared sketches. A sketch is shared once it has a
final sketch (item 30), and only shared sketches take likes and comments.

POST/DELETE /api/sketchers/{username}/follow     follow or unfollow
GET         /api/sketchers/{username}/followers  who follows them, newest first
POST/DELETE /api/sketches/{sketch_id}/like     like or unlike
GET         /api/sketches/{sketch_id}/comments oldest first
POST        /api/sketches/{sketch_id}/comments add one (1 to 1000 characters)
DELETE      /api/comments/{comment_id}         the author, or the sketch's owner

The helpers at the bottom give the counts the sketcher and sketch pages
show (sketchers/router.py, sketches/router.py).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth import get_current_sketcher_id, get_optional_sketcher_id
from app.core.database import get_db
from app.core.models import Follow, Profile, Sketch, SketchComment, SketchLike
from app.core.visibility import can_see

router = APIRouter(prefix="/api", tags=["community"])


class CommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


def _profile(db: Session, username: str) -> Profile:
    profile = db.query(Profile).filter(Profile.username == username.strip().lstrip("@").lower()).first()
    if profile is None:
        raise HTTPException(404, "Sketcher not found")
    return profile


def _shared_sketch(db: Session, sketch_id: str, viewer_id: str | None = None) -> Sketch:
    try:
        uuid.UUID(sketch_id)
    except ValueError:
        raise HTTPException(404, "Sketch not found")
    sketch = db.query(Sketch).filter(Sketch.id == sketch_id).first()
    if sketch is None or not sketch.final_sketch_url:
        raise HTTPException(404, "This sketch isn't shared yet")
    # Likes and comments follow who can see the sketch (core/visibility.py).
    if not can_see(db, sketch, viewer_id):
        raise HTTPException(404, "Sketch not found")
    return sketch


def person(p: Profile | None) -> dict:
    """The public face of a sketcher in a list: name, username, photo."""
    if p is None:
        return {"display_name": None, "username": None, "avatar_url": None}
    return {"display_name": p.display_name, "username": p.username, "avatar_url": p.avatar_url}


# ---- follows ----

@router.post("/sketchers/{username}/follow")
async def follow(username: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    target = _profile(db, username)
    if target.id == me:
        raise HTTPException(400, "You can't follow yourself")
    if db.get(Follow, (me, target.id)) is None:
        db.add(Follow(follower_id=me, followed_id=target.id))
        db.commit()
    return {"is_following": True, **follow_counts(db, target.id)}


@router.delete("/sketchers/{username}/follow")
async def unfollow(username: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    target = _profile(db, username)
    row = db.get(Follow, (me, target.id))
    if row is not None:
        db.delete(row)
        db.commit()
    return {"is_following": False, **follow_counts(db, target.id)}


@router.get("/sketchers/{username}/followers")
async def followers(username: str, db: Session = Depends(get_db)):
    target = _profile(db, username)
    rows = (
        db.query(Profile)
        .join(Follow, Follow.follower_id == Profile.id)
        .filter(Follow.followed_id == target.id)
        .order_by(Follow.created_at.desc())
        .limit(200)
        .all()
    )
    return [person(p) for p in rows]


def follow_counts(db: Session, sketcher_id: str) -> dict:
    return {
        "followers": db.query(func.count()).select_from(Follow).filter(Follow.followed_id == sketcher_id).scalar(),
        "following": db.query(func.count()).select_from(Follow).filter(Follow.follower_id == sketcher_id).scalar(),
    }


def is_following(db: Session, viewer_id: str | None, sketcher_id: str) -> bool:
    return bool(viewer_id) and db.get(Follow, (viewer_id, sketcher_id)) is not None


# ---- likes ----

@router.post("/sketches/{sketch_id}/like")
async def like(sketch_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    sketch = _shared_sketch(db, sketch_id, me)
    if sketch.sketcher_id == me:
        raise HTTPException(400, "You can't like your own sketch")
    if db.get(SketchLike, (sketch.id, me)) is None:
        db.add(SketchLike(sketch_id=sketch.id, sketcher_id=me))
        db.commit()
    return {"liked": True, "like_count": like_count(db, sketch.id)}


@router.delete("/sketches/{sketch_id}/like")
async def unlike(sketch_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    sketch = _shared_sketch(db, sketch_id, me)
    row = db.get(SketchLike, (sketch.id, me))
    if row is not None:
        db.delete(row)
        db.commit()
    return {"liked": False, "like_count": like_count(db, sketch.id)}


def like_count(db: Session, sketch_id: str) -> int:
    return db.query(func.count()).select_from(SketchLike).filter(SketchLike.sketch_id == sketch_id).scalar()


def liked_by(db: Session, viewer_id: str | None, sketch_id: str) -> bool:
    return bool(viewer_id) and db.get(SketchLike, (sketch_id, viewer_id)) is not None


def like_summary(db: Session, sketch_ids: list[str], viewer_id: str | None) -> dict:
    """Likes for a list of sketches in two queries: {id: (count, liked)}.
    For the sketch cards in feeds and search."""
    if not sketch_ids:
        return {}
    counts = dict(
        db.query(SketchLike.sketch_id, func.count())
        .filter(SketchLike.sketch_id.in_(sketch_ids))
        .group_by(SketchLike.sketch_id)
        .all()
    )
    mine = set()
    if viewer_id:
        mine = {
            r[0] for r in db.query(SketchLike.sketch_id)
            .filter(SketchLike.sketch_id.in_(sketch_ids), SketchLike.sketcher_id == viewer_id)
            .all()
        }
    return {i: (counts.get(i, 0), i in mine) for i in sketch_ids}


# ---- comments ----

def _comment_to_dict(c: SketchComment, author: Profile | None) -> dict:
    return {"id": c.id, "body": c.body, "created_at": c.created_at, "author_id": c.author_id, "author": person(author)}


@router.get("/sketches/{sketch_id}/comments")
async def list_comments(sketch_id: str, db: Session = Depends(get_db), viewer: str | None = Depends(get_optional_sketcher_id)):
    sketch = _shared_sketch(db, sketch_id, viewer)
    rows = (
        db.query(SketchComment, Profile)
        .outerjoin(Profile, Profile.id == SketchComment.author_id)
        .filter(SketchComment.sketch_id == sketch.id)
        .order_by(SketchComment.created_at.asc())
        .limit(500)
        .all()
    )
    return [_comment_to_dict(c, p) for c, p in rows]


@router.post("/sketches/{sketch_id}/comments")
async def add_comment(
    sketch_id: str,
    body: CommentRequest,
    db: Session = Depends(get_db),
    me: str = Depends(get_current_sketcher_id),
):
    sketch = _shared_sketch(db, sketch_id, me)
    text = body.body.strip()
    if not text:
        raise HTTPException(422, "A comment needs some words.")
    c = SketchComment(sketch_id=sketch.id, author_id=me, body=text)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _comment_to_dict(c, db.query(Profile).filter(Profile.id == me).first())


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    try:
        uuid.UUID(comment_id)
    except ValueError:
        raise HTTPException(404, "Comment not found")
    c = db.query(SketchComment).filter(SketchComment.id == comment_id).first()
    if c is None:
        raise HTTPException(404, "Comment not found")
    owner = db.query(Sketch.sketcher_id).filter(Sketch.id == c.sketch_id).scalar()
    if me not in (c.author_id, owner):
        raise HTTPException(403, "Only the author or the sketch's owner can remove a comment")
    db.delete(c)
    db.commit()
    return {"deleted": True}


def comment_count(db: Session, sketch_id: str) -> int:
    return db.query(func.count()).select_from(SketchComment).filter(SketchComment.sketch_id == sketch_id).scalar()
