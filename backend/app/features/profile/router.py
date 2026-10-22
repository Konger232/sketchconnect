"""
GET/PUT /api/profile -- the sketcher's own profile row (display name,
avatar, location, and for the sketcher page: username, self-introduction,
links). There's no trigger creating a profiles row when someone signs up
(auth.users and public.profiles aren't linked automatically), so GET
creates it on first visit instead of 404ing, seeded from the sign-in:
the Google name and photo when there are any, and a username made from the
name or the email (core/usernames.py). A profile from before usernames gets
one the next time it is read.

POST /api/profile/kit-photos, DELETE /api/profile/kit-photos/{i} -- What's in my bag: up to 3 photos (item 44).
"""
import io
import re
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image, ImageOps
from sqlalchemy.orm import Session

from app.core import usernames
from app.core.database import get_db
from app.core.auth import get_current_claims, get_current_sketcher_id
from app.core.models import Profile, Sketch
from app.core.paths import UPLOAD_DIR
from app.features.profile.schemas import ProfileUpdateRequest
from app.core.media import stored_url
from app.core.models import KitItem
from app.features.kit.router import MAX_KIT_PHOTOS, kit_photos

router = APIRouter(prefix="/api", tags=["profile"])


# Links a sketcher page can show (design doc, item 36), in this order.
LINK_KINDS = ("instagram", "tiktok", "facebook", "website")
MAX_LINK_CHARS = 200
MAX_FEATURED = 5
MAX_FAVORITE_PAINTS = 24
PAINT_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")


def _profile_to_dict(p: Profile) -> dict:
    return {
        "id": p.id,
        "display_name": p.display_name,
        "avatar_url": p.avatar_url,
        "location": p.location,
        "username": p.username,
        "bio": p.bio,
        "links": p.links or {},
        "favorite_paints": p.favorite_paints or [],
        "featured_sketch_ids": p.featured_sketch_ids or [],
        "kit_photo_url": p.kit_photo_url,
        "kit_photos": kit_photos(p),
    }


def _clean_links(links: dict[str, str]) -> dict[str, str]:
    """Keep known kinds with a web address. An empty value removes the link."""
    out = {}
    for kind in LINK_KINDS:
        url = (links.get(kind) or "").strip()
        if not url:
            continue
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        host = urlparse(url).netloc
        if len(url) > MAX_LINK_CHARS or " " in url or "." not in host:
            raise HTTPException(422, f"The {kind} link doesn't look like a web address.")
        out[kind] = url
    return out


def _get_or_create_profile(db: Session, sketcher_id: str, claims: dict | None = None) -> Profile:
    profile = db.query(Profile).filter(Profile.id == sketcher_id).first()
    changed = False
    if profile is None:
        meta = (claims or {}).get("user_metadata") or {}
        profile = Profile(
            id=sketcher_id,
            display_name=(meta.get("full_name") or meta.get("name") or None),
            avatar_url=(meta.get("avatar_url") or meta.get("picture") or None),
        )
        db.add(profile)
        changed = True
    if not profile.username:
        email = (claims or {}).get("email") or ""
        profile.username = usernames.make_unique(db, profile.display_name or email.split("@")[0], except_id=sketcher_id)
        changed = True
    if changed:
        db.commit()
        db.refresh(profile)
    return profile


@router.get("/profile")
async def get_profile(
    db: Session = Depends(get_db),
    claims: dict = Depends(get_current_claims),
):
    return _profile_to_dict(_get_or_create_profile(db, claims["sub"], claims))


@router.put("/profile")
async def update_profile(
    body: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    profile = _get_or_create_profile(db, sketcher_id)
    if body.display_name is not None:
        profile.display_name = body.display_name
    if body.avatar_url is not None:
        # A signed /media link sent back as is: store the file path.
        profile.avatar_url = stored_url(body.avatar_url)
    if body.location is not None:
        profile.location = body.location
    if body.bio is not None:
        profile.bio = body.bio.strip() or None
    if body.links is not None:
        profile.links = _clean_links(body.links)
    if body.favorite_paints is not None:
        ids = [i for i in dict.fromkeys(body.favorite_paints) if PAINT_ID.match(i)]
        profile.favorite_paints = ids[:MAX_FAVORITE_PAINTS]
    if body.featured_sketch_ids is not None:
        # Only the sketcher's own shared sketches, in the order given.
        wanted = list(dict.fromkeys(body.featured_sketch_ids))[:MAX_FEATURED]
        shared = {
            sid for (sid,) in db.query(Sketch.id).filter(
                Sketch.sketcher_id == sketcher_id, Sketch.final_sketch_url.isnot(None), Sketch.id.in_(wanted)
            ).all()
        } if wanted else set()
        profile.featured_sketch_ids = [i for i in wanted if i in shared]
    if body.username is not None:
        username = body.username.strip().lstrip("@").lower()
        if username != profile.username:
            reason = usernames.problem(username)
            if reason:
                raise HTTPException(422, reason)
            if usernames.is_taken(db, username, except_id=sketcher_id):
                raise HTTPException(409, f"@{username} is taken. Try another.")
            profile.username = username
    db.commit()
    db.refresh(profile)
    return _profile_to_dict(profile)


@router.post("/profile/kit-photos")
async def add_kit_photo(
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """What's in my bag (item 44): add a bag photo (MAX_KIT_PHOTOS). The app then
    asks the kit reading call to find the tools on it (POST /api/kit/read)."""
    profile = _get_or_create_profile(db, sketcher_id)
    photos = kit_photos(profile)
    if len(photos) >= MAX_KIT_PHOTOS:
        raise HTTPException(422, ("Your bag has its photo. Remove it first to add a new one." if MAX_KIT_PHOTOS == 1
                                 else f"Your bag holds at most {MAX_KIT_PHOTOS} photos. Remove one first."))
    contents = await image.read()
    try:
        pil = ImageOps.exif_transpose(Image.open(io.BytesIO(contents))).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not read that photo")
    pil.thumbnail((2000, 2000))
    filename = f"kit_{uuid.uuid4()}.jpg"
    pil.save(UPLOAD_DIR / filename, format="JPEG", quality=88)
    profile.kit_photos = photos + [f"/uploads/{filename}"]
    profile.kit_photo_url = profile.kit_photos[0]
    db.commit()
    return {"kit_photos": profile.kit_photos, "index": len(profile.kit_photos) - 1}


@router.delete("/profile/kit-photos/{index}")
async def remove_kit_photo(
    index: int,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """Remove a bag photo. Its tools stay in the kit, without their pins;
    the pins on later photos follow them down one place."""
    profile = _get_or_create_profile(db, sketcher_id)
    photos = kit_photos(profile)
    if not 0 <= index < len(photos):
        raise HTTPException(404, "No bag photo there")
    gone = photos.pop(index)
    profile.kit_photos = photos
    profile.kit_photo_url = photos[0] if photos else None
    for item in db.query(KitItem).filter(KitItem.sketcher_id == sketcher_id).all():
        spot = item.spot or {}
        if spot.get("photo") == index:
            item.spot = None
        elif isinstance(spot.get("photo"), int) and spot["photo"] > index:
            item.spot = {**spot, "photo": spot["photo"] - 1}
    db.commit()
    (UPLOAD_DIR / gone.rsplit("/", 1)[-1]).unlink(missing_ok=True)
    return {"kit_photos": photos}
