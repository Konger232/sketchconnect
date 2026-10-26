"""
Scouted spots (design doc, item 50): a place a sketcher found and may come
back to sketch, with a note and up to 10 photos. Private by default, or
shown to followers. The first photo with GPS places a spot that has no
place yet; each photo keeps the time it was taken.

GET    /api/spots                      my spots, newest first
GET    /api/sketchers/{username}/spots their spots I may see (followers)
POST   /api/spots                      add one
PUT    /api/spots/{id}                 change its name, note, place, who sees it
DELETE /api/spots/{id}                 remove it and its photos
POST   /api/spots/{id}/photos          add photos (one file per call)
DELETE /api/spots/{id}/photos/{photo_id}
"""
import io
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from geoalchemy2.elements import WKTElement
from geoalchemy2.shape import to_shape
from PIL import Image, ImageOps
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth import get_current_sketcher_id, get_optional_sketcher_id
from app.core.database import get_db
from app.core.exif_utils import extract_location_and_time
from app.core.models import Follow, Profile, Spot, SpotPhoto
from app.core.paths import UPLOAD_DIR
from app.features.geocode.service import reverse_geocode
from app.features.spots.schemas import SpotRequest

router = APIRouter(prefix="/api", tags=["spots"])

MAX_PHOTOS = 10


def spot_dict(s: Spot, photos: list[SpotPhoto]) -> dict:
    loc = None
    if s.location is not None:
        pt = to_shape(s.location)
        loc = {"lat": pt.y, "lon": pt.x, "label": s.place_name}
    return {
        "id": s.id, "name": s.name, "note": s.note, "place_name": s.place_name, "location": loc,
        "visibility": s.visibility, "created_at": s.created_at,
        "photos": [{"id": p.id, "url": p.image_url, "taken_at": p.taken_at} for p in sorted(photos, key=lambda p: p.position)],
    }


def _with_photos(db: Session, spots: list[Spot]) -> list[dict]:
    ids = [s.id for s in spots]
    photos: dict[str, list[SpotPhoto]] = {}
    for p in db.query(SpotPhoto).filter(SpotPhoto.spot_id.in_(ids or [""])).all():
        photos.setdefault(p.spot_id, []).append(p)
    return [spot_dict(s, photos.get(s.id, [])) for s in spots]


def _mine(db: Session, spot_id: str, me: str) -> Spot:
    s = db.get(Spot, spot_id)
    if s is None or s.sketcher_id != me:
        raise HTTPException(404, "Spot not found")
    return s


@router.get("/spots")
def my_spots(db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    rows = db.query(Spot).filter(Spot.sketcher_id == me).order_by(Spot.created_at.desc()).all()
    return _with_photos(db, rows)


@router.get("/sketchers/{username}/spots")
def their_spots(username: str, db: Session = Depends(get_db), viewer: str | None = Depends(get_optional_sketcher_id)):
    p = db.query(Profile).filter(func.lower(Profile.username) == username.lower()).first()
    if p is None:
        raise HTTPException(404, "Sketcher not found")
    q = db.query(Spot).filter(Spot.sketcher_id == p.id)
    if viewer != p.id:
        follows = viewer and db.get(Follow, (viewer, p.id)) is not None
        if not follows:
            return []
        q = q.filter(Spot.visibility == "followers")
    return _with_photos(db, q.order_by(Spot.created_at.desc()).all())


def _apply(s: Spot, body: SpotRequest) -> None:
    s.name = " ".join(body.name.split())
    s.note = (body.note or "").strip() or None
    s.visibility = body.visibility
    if body.lat is not None and body.lon is not None:
        s.location = WKTElement(f"POINT({body.lon} {body.lat})", srid=4326)
        s.place_name = (body.place_name or "").strip() or None


@router.post("/spots")
def add_spot(body: SpotRequest, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    s = Spot(id=str(uuid.uuid4()), sketcher_id=me)
    _apply(s, body)
    db.add(s)
    db.commit()
    return spot_dict(s, [])


@router.put("/spots/{spot_id}")
def update_spot(spot_id: str, body: SpotRequest, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    s = _mine(db, spot_id, me)
    _apply(s, body)
    db.commit()
    return _with_photos(db, [s])[0]


@router.delete("/spots/{spot_id}")
def delete_spot(spot_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    s = _mine(db, spot_id, me)
    db.query(SpotPhoto).filter(SpotPhoto.spot_id == s.id).delete()
    db.delete(s)
    db.commit()
    return {"deleted": True}


@router.post("/spots/{spot_id}/photos")
async def add_photo(spot_id: str, image: UploadFile = File(...), db: Session = Depends(get_db),
                    me: str = Depends(get_current_sketcher_id)):
    s = _mine(db, spot_id, me)
    count = db.query(func.count()).select_from(SpotPhoto).filter(SpotPhoto.spot_id == s.id).scalar()
    if count >= MAX_PHOTOS:
        raise HTTPException(422, f"A spot holds at most {MAX_PHOTOS} photos.")
    try:
        raw = Image.open(io.BytesIO(await image.read()))
        where, when = extract_location_and_time(raw)
        pil = ImageOps.exif_transpose(raw).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not read that photo")
    pil.thumbnail((2000, 2000))
    name = f"spot_{uuid.uuid4()}.jpg"
    pil.save(UPLOAD_DIR / name, format="JPEG", quality=86)
    db.add(SpotPhoto(spot_id=s.id, image_url=f"/uploads/{name}", taken_at=when, position=count))
    # The first photo with GPS places a spot that has no place yet.
    if s.location is None and where:
        s.location = WKTElement(f"POINT({where['lon']} {where['lat']})", srid=4326)
        s.place_name = await reverse_geocode(where["lat"], where["lon"])
    db.commit()
    return _with_photos(db, [s])[0]


@router.delete("/spots/{spot_id}/photos/{photo_id}")
def delete_photo(spot_id: str, photo_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    s = _mine(db, spot_id, me)
    db.query(SpotPhoto).filter(SpotPhoto.spot_id == s.id, SpotPhoto.id == photo_id).delete()
    for i, p in enumerate(db.query(SpotPhoto).filter(SpotPhoto.spot_id == s.id).order_by(SpotPhoto.position).all()):
        p.position = i
    db.commit()
    return _with_photos(db, [s])[0]
