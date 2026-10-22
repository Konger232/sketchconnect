"""
My kit (design doc, item 28): the tools a sketcher carries, grouped by
kind. Settings lists, adds, edits and removes them here.

GET    /api/kit             the signed-in sketcher's kit, by kind
POST   /api/kit             add one tool
PUT    /api/kit/{item_id}   replace one tool's fields
DELETE /api/kit/{item_id}   remove one tool

Each kind keeps only its own detail fields (KIND_DETAILS). Pigment codes,
medium and opacity belong to `color` items only, and codes are checked
against the Colour Index pattern printed on tubes (PB29, PBr7, PB15:3).
The kit photo and the kit reading call come later and add items with
source `ai`.
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_sketcher_id
from app.core.database import get_db
from app.core.models import KitItem, Profile
from app.features.kit.schemas import KitItemRequest, KitReadRequest
from config import MAX_KIT_ITEMS

MAX_KIT_PHOTOS = 3  # What's in my bag: up to 3 photos (item 44)

router = APIRouter(prefix="/api", tags=["kit"])

KIND_ORDER = ["line", "ink", "color", "brush", "paper", "extra"]

# The detail fields each kind keeps. Every kind takes a short `note`
# ("the everyday line"), shown beside the tool on the sketcher page. Text
# fields are trimmed to 40 characters, the note to 80; `waterproof` is a
# yes or no; `surface` is one of three. A paint's `brand` is the one the
# paint editor picked.
KIND_DETAILS = {
    "line": {"note": str, "size": str, "ink": str, "waterproof": bool},
    "ink": {"note": str, "waterproof": bool},
    "color": {"note": str, "brand": str},
    "brush": {"note": str, "size": str},
    "paper": {"note": str, "size": str, "weight": str, "surface": ("cold_press", "hot_press", "rough")},
    "extra": {"note": str},
}
MAX_DETAIL_CHARS = 40
MAX_NOTE_CHARS = 80
MAX_PIGMENT_CODES = 4

# Colour Index pigment codes as printed on tubes: P, a hue family, a
# number, and an optional variant (PB15:3). Two-letter families first.
PIGMENT_CODE = re.compile(r"^P(BK|BR|B|R|Y|O|G|V|W|M)(\d{1,3})(:\d{1,2})?$")
FAMILY_SPELLING = {"BK": "Bk", "BR": "Br"}


def _clean_details(kind: str, details: dict) -> dict:
    out = {}
    for key, rule in KIND_DETAILS[kind].items():
        value = details.get(key)
        if value is None or value == "":
            continue
        if rule is str:
            text = str(value).strip()[: MAX_NOTE_CHARS if key == "note" else MAX_DETAIL_CHARS]
            if text:
                out[key] = text
        elif rule is bool:
            out[key] = bool(value)
        elif value in rule:
            out[key] = value
    return out


def _clean_pigment_codes(codes: list[str]) -> list[str]:
    out = []
    for raw in codes:
        code = re.sub(r"\s+", "", str(raw)).upper()
        if not code:
            continue
        m = PIGMENT_CODE.match(code)
        if m is None:
            raise HTTPException(422, f"\"{raw}\" is not a pigment code. Codes look like PB29 or PBr7.")
        family = FAMILY_SPELLING.get(m.group(1), m.group(1))
        code = f"P{family}{m.group(2)}{m.group(3) or ''}"
        if code not in out:
            out.append(code)
    if len(out) > MAX_PIGMENT_CODES:
        raise HTTPException(422, f"A paint can list at most {MAX_PIGMENT_CODES} pigment codes.")
    return out


def _apply(item: KitItem, body: KitItemRequest) -> None:
    item.kind = body.kind
    item.label = body.label.strip()
    if not item.label:
        raise HTTPException(422, "A tool needs a name.")
    item.details = _clean_details(body.kind, body.details)
    is_color = body.kind == "color"
    item.pigment_codes = _clean_pigment_codes(body.pigment_codes) if is_color else []
    item.medium = body.medium if is_color else None
    item.opacity = body.opacity if is_color else None
    item.pinned = body.pinned
    item.hidden = body.hidden
    item.spot = clean_spot(body.spot)


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


def _to_dict(item: KitItem) -> dict:
    return {
        "id": item.id,
        "kind": item.kind,
        "label": item.label,
        "details": item.details or {},
        "pigment_codes": item.pigment_codes or [],
        "medium": item.medium,
        "opacity": item.opacity,
        "source": item.source,
        "pinned": item.pinned,
        "hidden": item.hidden,
        "spot": item.spot,
        "created_at": item.created_at,
    }


def _own_item(db: Session, item_id: str, sketcher_id: str) -> KitItem:
    item = db.query(KitItem).filter(KitItem.id == item_id, KitItem.sketcher_id == sketcher_id).first()
    if item is None:
        raise HTTPException(404, "Tool not found")
    return item


@router.get("/kit")
async def list_kit(
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """The kit, grouped by kind in KIND_ORDER, pinned tools first, then oldest first."""
    rows = db.query(KitItem).filter(KitItem.sketcher_id == sketcher_id).all()
    rows.sort(key=lambda i: (KIND_ORDER.index(i.kind), not i.pinned, i.created_at))
    return [_to_dict(i) for i in rows]


@router.post("/kit")
async def add_kit_item(
    body: KitItemRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    count = db.query(KitItem).filter(KitItem.sketcher_id == sketcher_id).count()
    if count >= MAX_KIT_ITEMS:
        raise HTTPException(422, f"A kit holds at most {MAX_KIT_ITEMS} tools.")
    item = KitItem(sketcher_id=sketcher_id, source="own")
    _apply(item, body)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_dict(item)


@router.put("/kit/{item_id}")
async def update_kit_item(
    item_id: str,
    body: KitItemRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    item = _own_item(db, item_id, sketcher_id)
    _apply(item, body)
    db.commit()
    db.refresh(item)
    return _to_dict(item)


@router.delete("/kit/{item_id}")
async def delete_kit_item(
    item_id: str,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    item = _own_item(db, item_id, sketcher_id)
    db.delete(item)
    db.commit()
    return {"deleted": True}


def kit_photos(profile: Profile | None) -> list[str]:
    """The bag photos, oldest first; the single kit photo from before."""
    if profile is None:
        return []
    if profile.kit_photos:
        return list(profile.kit_photos)[:MAX_KIT_PHOTOS]
    return [profile.kit_photo_url] if profile.kit_photo_url else []


@router.post("/kit/read")
def read_kit_photo(
    body: KitReadRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    The kit reading call (item 44): find the tools on one bag photo and add
    each as a tool with a pin (source `ai`). Tools found on this photo
    before are replaced; tools the sketcher added by hand stay. Returns the
    whole kit.
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

    mine = db.query(KitItem).filter(KitItem.sketcher_id == sketcher_id).all()
    for item in mine:
        if item.source == "ai" and (item.spot or {}).get("photo") == body.photo:
            db.delete(item)
    db.flush()
    room = MAX_KIT_ITEMS - db.query(KitItem).filter(KitItem.sketcher_id == sketcher_id).count()
    for t in tools[: max(0, room)]:
        db.add(KitItem(
            sketcher_id=sketcher_id, source="ai", kind=t["kind"], label=t["label"],
            details={"note": t["note"]} if t["note"] else {}, pigment_codes=[],
            spot={"photo": body.photo, "x": t["x"], "y": t["y"]},
        ))
    db.commit()
    rows = db.query(KitItem).filter(KitItem.sketcher_id == sketcher_id).all()
    rows.sort(key=lambda i: (KIND_ORDER.index(i.kind), not i.pinned, i.created_at))
    return {"found": len(tools), "kit": [_to_dict(i) for i in rows]}
