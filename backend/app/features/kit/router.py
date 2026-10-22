"""
What's in my bag (design doc, items 28 and 44): the tools a sketcher
carries, one row each, by category; up to 3 bag photos with a pin on each
tool; and the wish list, tools a sketcher starred in someone else's bag.

GET    /api/kit                  the signed-in sketcher's bag
POST   /api/kit                  add one tool
PUT    /api/kit/{item_id}        replace one tool's fields
DELETE /api/kit/{item_id}        remove one tool
POST   /api/kit/read             the kit reading call on one bag photo
GET    /api/wishlist             my wish list
POST   /api/wishlist/{item_id}   star a tool in someone else's bag
DELETE /api/wishlist/{item_id}   unstar it
POST   /api/wishlist/{item_id}/got   it's in my bag now: copy it, unstar it

Paints are not tools here: they are My palette (palette_items, features/paints).
"""
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_sketcher_id
from app.core.database import get_db
from app.core.models import KitItem, KitWish, Profile
from app.features.kit.schemas import KitItemRequest, KitReadRequest
from config import MAX_KIT_ITEMS

router = APIRouter(prefix="/api", tags=["kit"])

# The fixed list, in page order.
CATEGORY_ORDER = ["pen", "ink", "brush", "paper", "sketchbook", "palette", "clips", "easel", "bag", "other"]
MAX_KIT_PHOTOS = 1  # What's in my bag: one photo for the first release; the data holds up to 3 (item 44)
MAX_NOTE_WORDS = 30  # the short tip: up to 30 words
MAX_NOTE_CHARS = 300


def _to_dict(item: KitItem) -> dict:
    return {
        "id": item.id,
        "category": item.category,
        "label": item.label,
        "note": item.note,
        "link": item.link,
        "spot": item.spot,
        "source": item.source,
        "created_at": item.created_at,
    }


def sort_kit(rows: list) -> list:
    return sorted(rows, key=lambda i: (CATEGORY_ORDER.index(i.category) if i.category in CATEGORY_ORDER else 99, i.created_at))


def clean_spot(spot: dict | None) -> dict | None:
    """A pin on a bag photo: {photo: 0-2, x, y}, x and y from 0 to 1."""
    if not isinstance(spot, dict):
        return None
    try:
        photo = int(spot.get("photo"))
        x, y = float(spot.get("x")), float(spot.get("y"))
    except (TypeError, ValueError):
        return None
    if not 0 <= photo < MAX_KIT_PHOTOS:
        return None
    return {"photo": photo, "x": round(min(1.0, max(0.0, x)), 3), "y": round(min(1.0, max(0.0, y)), 3)}


def _clean_link(url: str | None) -> str | None:
    url = (url or "").strip()
    if not url:
        return None
    if "://" not in url:
        url = "https://" + url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(422, "That link doesn't look like a web address.")
    return url[:300]


def _apply(item: KitItem, body: KitItemRequest) -> None:
    item.category = body.category
    item.label = " ".join(body.label.split())
    if not item.label:
        raise HTTPException(422, "A tool needs a name.")
    words = (body.note or "").split()
    if len(words) > MAX_NOTE_WORDS:
        raise HTTPException(422, f"Keep the tip to {MAX_NOTE_WORDS} words.")
    item.note = " ".join(words)[:MAX_NOTE_CHARS] or None
    item.link = _clean_link(body.link)
    item.spot = clean_spot(body.spot)


def kit_photos(profile: Profile | None) -> list[str]:
    """The bag photos, oldest first; the single kit photo from before."""
    if profile is None:
        return []
    if profile.kit_photos:
        return list(profile.kit_photos)[:MAX_KIT_PHOTOS]
    return [profile.kit_photo_url] if profile.kit_photo_url else []


def _own_item(db: Session, item_id: str, sketcher_id: str) -> KitItem:
    item = db.query(KitItem).filter(KitItem.id == item_id, KitItem.sketcher_id == sketcher_id).first()
    if item is None:
        raise HTTPException(404, "Tool not found")
    return item


def _room(db: Session, sketcher_id: str) -> int:
    return MAX_KIT_ITEMS - db.query(KitItem).filter(KitItem.sketcher_id == sketcher_id).count()


@router.get("/kit")
def list_kit(db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    """The bag, by category in CATEGORY_ORDER, then oldest first."""
    return [_to_dict(i) for i in sort_kit(db.query(KitItem).filter(KitItem.sketcher_id == sketcher_id).all())]


@router.post("/kit")
def add_kit_item(body: KitItemRequest, db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    if _room(db, sketcher_id) <= 0:
        raise HTTPException(422, f"A bag holds at most {MAX_KIT_ITEMS} tools.")
    item = KitItem(sketcher_id=sketcher_id, source="own")
    _apply(item, body)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_dict(item)


@router.put("/kit/{item_id}")
def update_kit_item(item_id: str, body: KitItemRequest, db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    item = _own_item(db, item_id, sketcher_id)
    _apply(item, body)
    db.commit()
    db.refresh(item)
    return _to_dict(item)


@router.delete("/kit/{item_id}")
def delete_kit_item(item_id: str, db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    item = _own_item(db, item_id, sketcher_id)
    # It leaves everyone's wish list too.
    db.query(KitWish).filter(KitWish.kit_item_id == item.id).delete()
    db.delete(item)
    db.commit()
    return {"deleted": True}


@router.post("/kit/read")
def read_kit_photo(body: KitReadRequest, db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    """
    The kit reading call (item 44): find the tools on one bag photo and add
    each as a tool with a pin (source `ai`). Tools found on this photo
    before are replaced; tools the sketcher added stay. Returns the bag.
    """
    from PIL import Image, ImageOps
    from app.core.paths import UPLOAD_DIR
    from app.features.kit.service import read_kit
    photos = kit_photos(db.get(Profile, sketcher_id))
    if body.photo >= len(photos):
        raise HTTPException(404, "No bag photo there")
    try:
        img = ImageOps.exif_transpose(Image.open(UPLOAD_DIR / photos[body.photo].rsplit("/", 1)[-1])).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not read that photo")
    img.thumbnail((1600, 1600))
    try:
        tools = read_kit(img)
    except Exception as exc:
        print(f"[kit] reading failed: {exc}")
        raise HTTPException(502, "Could not read the tools right now. Try again, or add them by hand.")

    for item in db.query(KitItem).filter(KitItem.sketcher_id == sketcher_id, KitItem.source == "ai").all():
        if (item.spot or {}).get("photo") == body.photo:
            db.query(KitWish).filter(KitWish.kit_item_id == item.id).delete()
            db.delete(item)
    db.flush()
    for t in tools[: max(0, _room(db, sketcher_id))]:
        db.add(KitItem(
            sketcher_id=sketcher_id, source="ai", category=t["category"], label=t["label"],
            note=t["note"] or None, spot={"photo": body.photo, "x": t["x"], "y": t["y"]},
        ))
    db.commit()
    rows = sort_kit(db.query(KitItem).filter(KitItem.sketcher_id == sketcher_id).all())
    return {"found": len(tools), "kit": [_to_dict(i) for i in rows]}


# ---- the wish list ----

def wished_ids(db: Session, sketcher_id: str | None, item_ids: list[str]) -> set[str]:
    """Which of these tools the sketcher has starred."""
    if not sketcher_id or not item_ids:
        return set()
    return {w.kit_item_id for w in db.query(KitWish).filter(
        KitWish.sketcher_id == sketcher_id, KitWish.kit_item_id.in_(item_ids)
    ).all()}


@router.get("/wishlist")
def my_wishlist(db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    """My wish list, newest first: each tool with whose bag it's in."""
    rows = (
        db.query(KitWish, KitItem, Profile)
        .join(KitItem, KitItem.id == KitWish.kit_item_id)
        .outerjoin(Profile, Profile.id == KitItem.sketcher_id)
        .filter(KitWish.sketcher_id == sketcher_id)
        .order_by(KitWish.created_at.desc())
        .all()
    )
    return [{
        **_to_dict(item),
        "wished_at": w.created_at,
        "owner": {"display_name": p.display_name if p else None, "username": p.username if p else None,
                  "avatar_url": p.avatar_url if p else None},
    } for w, item, p in rows]


def _others_item(db: Session, item_id: str, sketcher_id: str) -> KitItem:
    item = db.query(KitItem).filter(KitItem.id == item_id).first()
    if item is None:
        raise HTTPException(404, "Tool not found")
    if item.sketcher_id == sketcher_id:
        raise HTTPException(400, "That one is already in your bag.")
    return item


@router.post("/wishlist/{item_id}")
def add_wish(item_id: str, db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    item = _others_item(db, item_id, sketcher_id)
    if db.get(KitWish, (sketcher_id, item.id)) is None:
        db.add(KitWish(sketcher_id=sketcher_id, kit_item_id=item.id))
        db.commit()
    return {"wished": True}


@router.delete("/wishlist/{item_id}")
def remove_wish(item_id: str, db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    db.query(KitWish).filter(KitWish.sketcher_id == sketcher_id, KitWish.kit_item_id == item_id).delete()
    db.commit()
    return {"wished": False}


@router.post("/wishlist/{item_id}/got")
def got_wish(item_id: str, db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    """It's in my bag now: a copy of the tool joins my bag (no pin), and it
    leaves my wish list."""
    item = _others_item(db, item_id, sketcher_id)
    if _room(db, sketcher_id) <= 0:
        raise HTTPException(422, f"A bag holds at most {MAX_KIT_ITEMS} tools.")
    mine = KitItem(sketcher_id=sketcher_id, source="own", category=item.category, label=item.label,
                   note=item.note, link=item.link)
    db.add(mine)
    db.query(KitWish).filter(KitWish.sketcher_id == sketcher_id, KitWish.kit_item_id == item.id).delete()
    db.commit()
    db.refresh(mine)
    return _to_dict(mine)
