"""
Admired sketchers (design doc, item 36, October 17, 2026): a list of names
on the sketcher page, visible only to the sketcher. Adding a name runs the
persona creation call once and stores the persona; the critique reuses it
whenever the sketcher picks that voice for a final sketch.

GET    /api/admired              the list, oldest first
POST   /api/admired              add a name (at most MAX_ADMIRED)
DELETE /api/admired/{persona_id} remove one; sketches that used it fall
                                 back to the default coach

PATCH  /api/admired/{persona_id} change the link or location (the voice
                                 stays; a new name means remove and add)

The older one-artist-per-style route (POST /api/persona) was removed with
the Settings page (October 17, 2026). Style personas made before still
serve older sketches (critique_agent/service.py).

HTTP layer and storage only; the Gemini call is in features/persona/service.py.
"""
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_sketcher_id
from app.core.models import Persona
from app.features.persona.schemas import AdmiredAddRequest, AdmiredUpdateRequest
from app.features.persona.service import generate_admired_persona

router = APIRouter(prefix="/api", tags=["persona"])

MAX_ADMIRED = 5


def admired_to_dict(p: Persona) -> dict:
    return {
        "id": p.id,
        "name": p.admired_artist_name,
        "persona_label": p.persona_label,
        "link": p.admired_link,
        "location": p.admired_location,
    }


def _clean_link(url: str | None) -> str | None:
    url = (url or "").strip()
    if not url:
        return None
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    if len(url) > 200 or " " in url or "." not in urlparse(url).netloc:
        raise HTTPException(422, "That link doesn't look like a web address.")
    return url


def admired_list(db: Session, sketcher_id: str) -> list[Persona]:
    return (
        db.query(Persona)
        .filter(Persona.sketcher_id == sketcher_id, Persona.style.is_(None), Persona.admired_artist_name.isnot(None))
        .order_by(Persona.updated_at)
        .all()
    )


@router.get("/admired")
async def list_admired(
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    return [admired_to_dict(p) for p in admired_list(db, sketcher_id)]


@router.post("/admired")
async def add_admired(
    body: AdmiredAddRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    name = " ".join(body.name.split())
    link = _clean_link(body.link)  # checked before the persona call
    current = admired_list(db, sketcher_id)
    if any((p.admired_artist_name or "").lower() == name.lower() for p in current):
        raise HTTPException(409, f"{name} is already on your list.")
    if len(current) >= MAX_ADMIRED:
        raise HTTPException(422, f"Your list holds at most {MAX_ADMIRED} sketchers.")
    try:
        result = generate_admired_persona(name)
    except Exception as exc:
        print(f"[persona] admired persona for {name!r} failed: {exc}")
        raise HTTPException(502, "Could not set up that voice right now. Try again.")
    persona = Persona(
        sketcher_id=sketcher_id,
        style=None,
        admired_artist_name=name,
        persona_source="sketcher_provided",
        persona_label=result["persona_label"],
        admired_link=link,
        admired_location=(body.location or "").strip()[:80] or None,
        voice=result["voice"],
        priorities=result["priorities"],
        tone=result["tone"],
    )
    db.add(persona)
    db.commit()
    db.refresh(persona)
    return admired_to_dict(persona)


@router.delete("/admired/{persona_id}")
async def remove_admired(
    persona_id: str,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    try:
        uuid.UUID(persona_id)
    except ValueError:
        raise HTTPException(404, "Not on your list")
    persona = db.query(Persona).filter(
        Persona.id == persona_id, Persona.sketcher_id == sketcher_id, Persona.style.is_(None)
    ).first()
    if persona is None:
        raise HTTPException(404, "Not on your list")
    db.delete(persona)  # sketches.persona_id is set null by the database
    db.commit()
    return {"deleted": True}


def _own_admired(db: Session, persona_id: str, sketcher_id: str) -> Persona:
    try:
        uuid.UUID(persona_id)
    except ValueError:
        raise HTTPException(404, "Not on your list")
    persona = db.query(Persona).filter(
        Persona.id == persona_id, Persona.sketcher_id == sketcher_id, Persona.style.is_(None)
    ).first()
    if persona is None:
        raise HTTPException(404, "Not on your list")
    return persona


@router.patch("/admired/{persona_id}")
async def update_admired(
    persona_id: str,
    body: AdmiredUpdateRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    persona = _own_admired(db, persona_id, sketcher_id)
    if body.link is not None:
        persona.admired_link = _clean_link(body.link)
    if body.location is not None:
        persona.admired_location = body.location.strip()[:80] or None
    db.commit()
    return admired_to_dict(persona)

