"""
Protected images (design doc: protecting sketchers' work, October 22, 2026).

Every image a sketcher uploads lives in uploads/ and is stored in the
database as "/uploads/<file>". That folder is no longer served as is.
Instead:

  /media/<file>?e=<expiry>&s=<signature>
      For signed-in sketchers. A display copy (1600 px on the long side,
      no GPS or camera data, the sketcher's name and a no-AI copyright note
      in the file), behind a link that expires after an hour or two. Bots
      can't sign in, and a copied link stops working.

  /teaser/<file>
      For visitors: the middle part of a shared final sketch only, small.

The API's JSON responses still carry "/uploads/<file>"; MediaLinkMiddleware
rewrites each one on the way out: a signed /media link for a signed-in
sketcher, a /teaser link for a visitor. Code that reads the files (the AI
calls, the value study) is unchanged.

The signing key: MEDIA_SIGNING_KEY in backend/.env, or a random key per
server start when it's not set (links then stop working on restart, and the
page fetches new ones). Set it yourself for a deployed server.
"""
import hashlib
import hmac
import math
import os
import re
import secrets
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from jose import jwt
from PIL import Image, ImageOps
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.core.paths import UPLOAD_DIR

DISPLAY_MAX = 1600       # px, the long side of the display copy
TEASER_SIDE = 480        # px, the teaser's square
TEASER_PART = 0.55       # the teaser shows this share of the short side, from the middle
LINK_HOURS = 2           # a signed link lasts 1 to 2 hours (rounded, so browsers can cache)
NO_AI = "noindex, noimageindex, noai, noimageai"

_KEY = (os.environ.get("MEDIA_SIGNING_KEY") or secrets.token_hex(32)).encode()
# File names may hold dots (seed_avatar_dana.johnson.png), never slashes.
_NAME = re.compile(r"^[A-Za-z0-9_\-][A-Za-z0-9_\-.]*\.(?:jpg|jpeg|png|webp|heic|heif)$", re.I)
_STORED = re.compile(rb'"/uploads/([A-Za-z0-9_\-][A-Za-z0-9_\-.]*\.(?:jpg|jpeg|png|webp|heic|heif))"', re.I)
_SIGNED = re.compile(r"^/media/([A-Za-z0-9_\-][A-Za-z0-9_\-.]*\.\w+)\?.*$")


def _valid(name: str) -> bool:
    """An original's file name: no "..", and not one of our own copies."""
    return bool(_NAME.match(name)) and ".." not in name and not name.endswith((".display.jpg", ".teaser.jpg"))

router = APIRouter(tags=["media"])


# ---- links ----

def _sig(name: str, exp: int) -> str:
    return hmac.new(_KEY, f"{name}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]


def signed_url(name: str) -> str:
    hour = 3600
    exp = (math.ceil(time.time() / hour) + LINK_HOURS - 1) * hour
    return f"/media/{name}?e={exp}&s={_sig(name, exp)}"


def stored_url(url: str | None) -> str | None:
    """A signed /media link sent back by the browser (e.g. the avatar on
    Edit Profile), as the "/uploads/<file>" the database keeps."""
    m = _SIGNED.match(url or "")
    return f"/uploads/{m.group(1)}" if m else url


def _viewer(request) -> str | None:
    """The signed-in sketcher's id from the request's bearer token, or None.
    The same check as app.core.auth, without raising."""
    from app.core.auth import SUPABASE_JWT_AUDIENCE, _find_key
    head = request.headers.get("authorization", "")
    if not head.lower().startswith("bearer "):
        return None
    token = head[7:]
    try:
        kid = jwt.get_unverified_header(token).get("kid")
        key = _find_key(kid) if kid else None
        if key is None:
            return None
        return jwt.decode(token, key, algorithms=[key.get("alg", "ES256")], audience=SUPABASE_JWT_AUDIENCE).get("sub")
    except Exception:
        return None


class MediaLinkMiddleware(BaseHTTPMiddleware):
    """Rewrites "/uploads/<file>" in /api JSON responses: a signed /media
    link for a signed-in sketcher, a /teaser link for a visitor."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if not request.url.path.startswith("/api/") or "application/json" not in response.headers.get("content-type", ""):
            return response
        body = b"".join([chunk async for chunk in response.body_iterator])
        if b'"/uploads/' in body:
            member = _viewer(request) is not None
            body = _STORED.sub(
                lambda m: f'"{signed_url(m.group(1).decode()) if member else "/teaser/" + m.group(1).decode()}"'.encode(),
                body,
            )
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        return Response(body, status_code=response.status_code, headers=headers, media_type="application/json")


# ---- the copies ----

def _owner_name(name: str) -> str | None:
    """Whose image this is, for the copyright note in the file."""
    from sqlalchemy import Text, cast, or_
    from app.core.database import ReadSession as SessionLocal  # reads only
    from app.core.models import Profile, Sketch, SketchUpload
    url = f"/uploads/{name}"
    db = SessionLocal()
    try:
        owner = (
            db.query(Sketch.sketcher_id).filter(or_(
                Sketch.reference_image_url == url, Sketch.final_sketch_url == url, Sketch.original_image_url == url,
            )).first()
            or db.query(SketchUpload.sketcher_id).filter(SketchUpload.url == url).first()
            or db.query(Profile.id).filter(or_(
                Profile.kit_photo_url == url, Profile.avatar_url == url, cast(Profile.kit_photos, Text).contains(url),
            )).first()
        )
        if not owner:
            return None
        p = db.get(Profile, owner[0])
        return (p.display_name or p.username) if p else None
    finally:
        db.close()


def _rights(name: str) -> str:
    year = datetime.now(timezone.utc).year
    who = _owner_name(name) or "the sketcher"
    return (f"Copyright {year} {who}. All rights reserved. Shared on SketchConnect. "
            "No copying, sharing, or use for AI training without the sketcher's permission.")


def _save_copy(src_name: str, out_name: str, make) -> None:
    out = UPLOAD_DIR / out_name
    if out.exists():
        return
    src = UPLOAD_DIR / src_name
    if not src.exists():
        raise HTTPException(404, "Not found")
    if src.suffix.lower() in (".heic", ".heif"):
        import pillow_heif
        pillow_heif.register_heif_opener()
    img = ImageOps.exif_transpose(Image.open(src))
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    img = make(img.convert("RGB"))
    # Only the sketcher's name and the rights note go in the file: no GPS,
    # no camera details from the original.
    exif = Image.Exif()
    note = _rights(src_name)
    exif[0x013B] = (_owner_name(src_name) or "")   # Artist
    exif[0x8298] = note                            # Copyright
    exif[0x010E] = note                            # ImageDescription
    tmp = out.with_suffix(".tmp")
    img.save(tmp, "JPEG", quality=82 if out_name.endswith(".display.jpg") else 70, exif=exif.tobytes(), optimize=True)
    tmp.replace(out)


def _trim_edges(img, limit: float = 0.02):
    """Trim thin black frame lines a screenshot or crop left on a bag
    photo (at most 2% a side), so they don't read as a page border. Bag
    photos only: a sketch's paper edge is part of the work, and its colour
    swatches sit at positions on the photo."""
    gray = img.convert("L")
    w, h = gray.size
    px = gray.load()

    def flat(values):
        vals = list(values)
        mean = sum(vals) / len(vals)
        return mean < 50 and max(vals) - min(vals) < 70

    step_x, step_y = max(1, w // 200), max(1, h // 200)
    top = 0
    while top < h * limit and flat(px[x, top] for x in range(0, w, step_x)):
        top += 1
    bottom = h
    while h - bottom < h * limit and flat(px[x, bottom - 1] for x in range(0, w, step_x)):
        bottom -= 1
    left = 0
    while left < w * limit and flat(px[left, y] for y in range(0, h, step_y)):
        left += 1
    right = w
    while w - right < w * limit and flat(px[right - 1, y] for y in range(0, h, step_y)):
        right -= 1
    return img.crop((left, top, right, bottom)) if (left, top, right, bottom) != (0, 0, w, h) else img


def _display(img):
    img.thumbnail((DISPLAY_MAX, DISPLAY_MAX))
    return img


def _display_bag(img):
    return _display(_trim_edges(img))


def _teaser(img):
    w, h = img.size
    side = int(min(w, h) * TEASER_PART)
    left, top = (w - side) // 2, (h - side) // 2
    return img.crop((left, top, left + side, top + side)).resize((TEASER_SIDE, TEASER_SIDE), Image.LANCZOS)


def _stem(name: str) -> str:
    return name.rsplit(".", 1)[0]


def _image_response(path, max_age: int, private: bool):
    return FileResponse(path, media_type="image/jpeg", headers={
        "Cache-Control": f"{'private' if private else 'public'}, max-age={max_age}",
        "X-Robots-Tag": NO_AI,
        "Content-Disposition": "inline",
    })


@router.get("/media/{name}")
def media(name: str, e: int = 0, s: str = ""):
    """A signed-in sketcher's display copy, while the link is valid."""
    if not _valid(name) or e < time.time() or not hmac.compare_digest(s, _sig(name, e)):
        raise HTTPException(403, "This link has expired. Reload the page.")
    out = f"{_stem(name)}.display.jpg"
    _save_copy(name, out, _display_bag if name.startswith("kit_") else _display)
    return _image_response(UPLOAD_DIR / out, max_age=int(e - time.time()), private=True)


@router.get("/teaser/{name}")
def teaser(name: str):
    """For visitors: the middle of a shared final sketch, and nothing else."""
    from app.core.database import ReadSession as SessionLocal  # reads only
    from app.core.models import Sketch
    if not _valid(name):
        raise HTTPException(404, "Not found")
    db = SessionLocal()
    try:
        shared = db.query(Sketch.id).filter(
            Sketch.final_sketch_url == f"/uploads/{name}", Sketch.visibility == "members",
        ).first()
    finally:
        db.close()
    if not shared:
        raise HTTPException(404, "Not found")
    out = f"{_stem(name)}.teaser.jpg"
    _save_copy(name, out, _teaser)
    return _image_response(UPLOAD_DIR / out, max_age=86400, private=False)
