"""
GET/PUT /api/profile -- the sketcher's own profile row (display name,
avatar, location, and for the sketcher page: handle, self-introduction,
links). There's no trigger creating a profiles row when someone signs up
(auth.users and public.profiles aren't linked automatically), so GET
creates it on first visit instead of 404ing, seeded from the sign-in:
the Google name and photo when there are any, and a handle made from the
name or the email (core/handles.py). A profile from before handles gets
one the next time it is read.

GET /api/personas -- read-only list of every per-style admired-artist
persona already set in Settings (design doc: "one artist per style" --
see app/features/persona/router.py). The profile page's "favorite urban sketchers"
section reads this instead of keeping its own separate field, so there's
exactly one place that data lives.
"""
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core import handles
from app.core.database import get_db
from app.core.auth import get_current_claims, get_current_sketcher_id
from app.core.models import Profile, Persona
from app.features.profile.schemas import ProfileUpdateRequest

router = APIRouter(prefix="/api", tags=["profile"])


# Links a sketcher page can show (design doc, item 36), in this order.
LINK_KINDS = ("instagram", "tiktok", "facebook", "website")
MAX_LINK_CHARS = 200


def _profile_to_dict(p: Profile) -> dict:
    return {
        "id": p.id,
        "display_name": p.display_name,
        "avatar_url": p.avatar_url,
        "location": p.location,
        "handle": p.handle,
        "bio": p.bio,
        "links": p.links or {},
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


def _persona_to_dict(p: Persona) -> dict:
    return {
        "style": p.style,
        "admired_artist_name": p.admired_artist_name,
        "persona_label": p.persona_label,
    }


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
    if not profile.handle:
        email = (claims or {}).get("email") or ""
        profile.handle = handles.make_unique(db, profile.display_name or email.split("@")[0], except_id=sketcher_id)
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
        profile.avatar_url = body.avatar_url
    if body.location is not None:
        profile.location = body.location
    if body.bio is not None:
        profile.bio = body.bio.strip() or None
    if body.links is not None:
        profile.links = _clean_links(body.links)
    if body.handle is not None:
        handle = body.handle.strip().lstrip("@").lower()
        if handle != profile.handle:
            reason = handles.problem(handle)
            if reason:
                raise HTTPException(422, reason)
            if handles.is_taken(db, handle, except_id=sketcher_id):
                raise HTTPException(409, f"@{handle} is taken. Try another.")
            profile.handle = handle
    db.commit()
    db.refresh(profile)
    return _profile_to_dict(profile)


@router.get("/personas")
async def list_personas(
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    rows = db.query(Persona).filter(Persona.sketcher_id == sketcher_id).all()
    return [_persona_to_dict(p) for p in rows]
