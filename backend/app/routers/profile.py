"""
GET/PUT /api/profile -- the sketcher's own profile row (display name,
avatar, location). There's no trigger creating a profiles row when someone
signs up (auth.users and public.profiles aren't linked automatically), so
GET upserts a bare row on first visit instead of 404ing.

GET /api/personas -- read-only list of every per-style admired-artist
persona already set in Settings (design doc: "one artist per style" --
see app/routers/persona.py). The profile page's "favorite urban sketchers"
section reads this instead of keeping its own separate field, so there's
exactly one place that data lives.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_sketcher_id
from ..models import Profile, Persona
from ..schemas import ProfileUpdateRequest

router = APIRouter(prefix="/api", tags=["profile"])


def _profile_to_dict(p: Profile) -> dict:
    return {
        "id": p.id,
        "display_name": p.display_name,
        "avatar_url": p.avatar_url,
        "location": p.location,
    }


def _persona_to_dict(p: Persona) -> dict:
    return {
        "style": p.style,
        "admired_artist_name": p.admired_artist_name,
        "persona_label": p.persona_label,
    }


def _get_or_create_profile(db: Session, sketcher_id: str) -> Profile:
    profile = db.query(Profile).filter(Profile.id == sketcher_id).first()
    if profile is None:
        profile = Profile(id=sketcher_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.get("/profile")
async def get_profile(
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    return _profile_to_dict(_get_or_create_profile(db, sketcher_id))


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
