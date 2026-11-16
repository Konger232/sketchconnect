"""
Shared links and the public sketch page (November 14, 2026).

A sketch shared on Facebook, WhatsApp, LINE or in an Instagram message is
a link to https://sketchconnect.web.app/s/<sketch id>. Firebase Hosting
sends /s/** here (frontend/firebase.json). Those apps read the page's Open
Graph tags for the preview card, without running any script; a person's
browser runs the script and goes on to the sketch page.

  GET /s/<id>             the tags, then on to /sketches/<id>
  GET /s/<id>/card.jpg    the card's picture: the final sketch, 1200 x 630
  GET /s/<id>/image.jpg   the final sketch for the public page, 1200 px
  GET /api/public/sketches/<id>   the public page's data (PublicSketch.jsx)
  GET /e/<id>, /e/<id>/card.jpg   the same for an event, its card from the
                          cover photo; people go on to /events/<id>

Only shared sketches (a final sketch, seen by everyone) have these. The
sketcher chose to share the final sketch, so it is shown whole (decided
November 16, 2026); the reference, plan, progress sketches, critique and
comments stay members-only. The pictures carry the copyright note in the
file, like every display copy (core/media.py).
"""
import html
import json
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from sqlalchemy.orm import Session

from app.core import media, storage
from app.core.database import get_db
from app.core.models import Event, Profile, Sketch
from config import ALLOWED_ORIGINS

router = APIRouter(tags=["share"])
_ID = re.compile(r"^[0-9a-fA-F-]{36}$")  # a sketch id: nothing else reaches the page or the database

CARD_W, CARD_H = 1200, 630   # Facebook's link card
PUBLIC_MAX = 1200            # the public page's picture, long side
MARK = "SketchConnect"


def _site(request: Request) -> str:
    """The public site's address: the first FRONTEND_ORIGINS entry that is
    not localhost, else the address the visitor used (Vite's proxy on a Mac
    passes it on), else this server's."""
    for origin in ALLOWED_ORIGINS:
        if "localhost" not in origin:
            return origin
    host = request.headers.get("x-forwarded-host")
    if host:
        return f"{request.headers.get('x-forwarded-proto', 'http').split(',')[0]}://{host.split(',')[0]}"
    return str(request.base_url).rstrip("/")


def _shared(db: Session, sketch_id: str) -> Sketch | None:
    """The sketch, if anyone may see it: a final sketch, shown to everyone."""
    if not _ID.match(sketch_id or ""):
        return None
    s = db.get(Sketch, sketch_id)
    if s is None or not s.final_sketch_url or (s.visibility or "members") != "members":
        return None
    return s


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow before 10.1
        return ImageFont.load_default()


def _card(img: Image.Image) -> Image.Image:
    """The sketch whole, on a blurred, darkened copy of itself (no white
    bars), with a small SketchConnect mark."""
    bg = img.copy()
    scale = max(CARD_W / bg.width, CARD_H / bg.height)
    bg = bg.resize((max(1, int(bg.width * scale)), max(1, int(bg.height * scale))))
    left, top = (bg.width - CARD_W) // 2, (bg.height - CARD_H) // 2
    bg = bg.crop((left, top, left + CARD_W, top + CARD_H)).filter(ImageFilter.GaussianBlur(28))
    bg = Image.blend(bg, Image.new("RGB", bg.size, (0, 0, 0)), 0.45)
    fit = img.copy()
    fit.thumbnail((CARD_W, CARD_H))
    bg.paste(fit, ((CARD_W - fit.width) // 2, (CARD_H - fit.height) // 2))
    d = ImageDraw.Draw(bg)
    font = _font(26)
    w = d.textlength(MARK, font=font)
    x, y = CARD_W - w - 22, CARD_H - 44
    d.text((x + 1, y + 1), MARK, font=font, fill=(0, 0, 0))
    d.text((x, y), MARK, font=font, fill=(255, 255, 255))
    return bg


def _public(img: Image.Image) -> Image.Image:
    img.thumbnail((PUBLIC_MAX, PUBLIC_MAX))
    return img


def _picture(s: Sketch, kind: str):
    """The card or the public picture of a shared sketch, made once and
    stored beside the original (core/media.py's _save_copy)."""
    name = storage.name_of(s.final_sketch_url)
    out = f"{media._stem(name)}.{kind}.jpg"
    path = media._save_copy(name, out, _card if kind == "card" else _public)
    return media._image_response(path, max_age=86400, private=False)


@router.get("/s/{sketch_id}/card.jpg")
def card(sketch_id: str, db: Session = Depends(get_db)):
    s = _shared(db, sketch_id)
    if s is None:
        raise HTTPException(404, "Not found")
    return _picture(s, "card")


@router.get("/s/{sketch_id}/image.jpg")
def public_image(sketch_id: str, db: Session = Depends(get_db)):
    s = _shared(db, sketch_id)
    if s is None:
        raise HTTPException(404, "Not found")
    return _picture(s, "public")


def _owner(db: Session, s: Sketch) -> Profile | None:
    return db.get(Profile, s.sketcher_id)


@router.get("/api/public/sketches/{sketch_id}")
def public_sketch(sketch_id: str, db: Session = Depends(get_db)):
    """What anyone may see of a shared sketch (PublicSketch.jsx)."""
    s = _shared(db, sketch_id)
    if s is None:
        raise HTTPException(404, "This sketch is not shared.")
    p = _owner(db, s)
    avatar = p.avatar_url if p and (p.avatar_url or "").startswith("http") else None
    when = s.final_at or s.captured_at or s.created_at
    return {
        "id": s.id,
        "title": s.title,
        "place": s.location_label,
        "date": when.isoformat() if when else None,
        "owner": {"display_name": p.display_name if p else None, "username": p.username if p else None, "avatar_url": avatar},
        "image": f"/s/{s.id}/image.jpg",
    }


def _tags_page(site: str, share_url: str, page: str, title: str, desc: str, image: str | None) -> HTMLResponse:
    """A page of Open Graph tags that sends a person on to `page`."""
    e = html.escape
    go = json.dumps(page).replace("</", "<\\/")  # safe inside the script tag
    tags = [
        ('og:type', 'article'), ('og:site_name', 'SketchConnect'), ('og:title', title),
        ('og:description', desc), ('og:url', share_url),
    ]
    if image:
        tags += [('og:image', image), ('og:image:width', str(CARD_W)), ('og:image:height', str(CARD_H))]
    meta = "\n".join(f'<meta property="{k}" content="{e(v)}">' for k, v in tags)
    twitter = f'<meta name="twitter:card" content="{"summary_large_image" if image else "summary"}">'
    body = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)} · SketchConnect</title>
<meta name="description" content="{e(desc)}">
{meta}
{twitter}
<script>location.replace({go});</script>
</head><body style="font-family:sans-serif;padding:2rem">
<p><a href="{e(page)}">{e(title)} on SketchConnect</a></p>
</body></html>"""
    return HTMLResponse(body, headers={"Cache-Control": "public, max-age=600", "X-Robots-Tag": "noai, noimageai"})


GENERIC = ("SketchConnect", "Sketches, made on location, shared by the sketchers who made them.")


@router.get("/s/{sketch_id}", response_class=HTMLResponse)
def share_page(sketch_id: str, request: Request, db: Session = Depends(get_db)):
    """The Open Graph tags for a link preview, then on to the sketch page."""
    if not _ID.match(sketch_id or ""):
        raise HTTPException(404, "Not found")
    site = _site(request)
    s = _shared(db, sketch_id)
    if s is None:
        title, desc, image = *GENERIC, None
    else:
        p = _owner(db, s)
        who = (p.display_name or (f"@{p.username}" if p.username else None)) if p else None
        title = s.title or "A sketch on SketchConnect"
        desc = " · ".join(x for x in (f"Sketched by {who}" if who else None, s.location_label) if x) or "A sketch on SketchConnect"
        image = f"{site}/s/{s.id}/card.jpg"
    return _tags_page(site, f"{site}/s/{sketch_id}", f"{site}/sketches/{sketch_id}", title, desc, image)


# ---- events ----

def _event(db: Session, event_id: str) -> Event | None:
    if not _ID.match(event_id or ""):
        return None
    ev = db.get(Event, event_id)
    return None if ev is None or ev.hidden else ev


def _event_when(ev: Event) -> str:
    """"Sat 21 Nov 2026, 9:00 AM" in the event's own time zone."""
    from zoneinfo import ZoneInfo
    try:
        t = ev.starts_at.astimezone(ZoneInfo(ev.time_zone or "UTC"))
    except Exception:
        t = ev.starts_at
    return t.strftime("%a %-d %b %Y, %-I:%M %p")


@router.get("/e/{event_id}/card.jpg")
def event_card(event_id: str, db: Session = Depends(get_db)):
    ev = _event(db, event_id)
    if ev is None or not ev.cover_image_url:
        raise HTTPException(404, "Not found")
    name = storage.name_of(ev.cover_image_url)
    path = media._save_copy(name, f"{media._stem(name)}.card.jpg", _card)
    return media._image_response(path, max_age=86400, private=False)


@router.get("/e/{event_id}", response_class=HTMLResponse)
def event_share_page(event_id: str, request: Request, db: Session = Depends(get_db)):
    """An event's link preview: its title, when and where, and its cover."""
    if not _ID.match(event_id or ""):
        raise HTTPException(404, "Not found")
    site = _site(request)
    ev = _event(db, event_id)
    if ev is None:
        title, desc, image = *GENERIC, None
    else:
        title = ev.title
        desc = " · ".join(x for x in (_event_when(ev), ev.place_name) if x)
        image = f"{site}/e/{ev.id}/card.jpg" if ev.cover_image_url else None
    return _tags_page(site, f"{site}/e/{event_id}", f"{site}/events/{event_id}", title, desc, image)
