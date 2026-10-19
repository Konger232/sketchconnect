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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
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
        # The voice is built in the background after the name is added.
        "ready": bool(p.voice),
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


def build_admired_voice(persona_id: str) -> None:
    """
    Builds an admired sketcher's voice after the name is saved (runs in the
    background, in its own DB session). If the call fails, the voice stays
    empty, and the critique builds it the first time it is used
    (critique_agent/service.py, _persona_for).
    """
    db = SessionLocal()
    try:
        persona = db.query(Persona).filter(Persona.id == persona_id).first()
        if persona is None or persona.voice:
            return  # removed meanwhile, or already built
        fill_admired_voice(persona)
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"[persona] admired voice {persona_id} failed: {exc}")
    finally:
        db.close()


def fill_admired_voice(persona: Persona) -> None:
    """One persona creation call, written onto the row (not committed)."""
    result = generate_admired_persona(persona.admired_artist_name)
    persona.persona_label = result["persona_label"]
    persona.voice = result["voice"]
    persona.priorities = result["priorities"]
    persona.tone = result["tone"]


@router.post("/admired")
async def add_admired(
    body: AdmiredAddRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """Saves the name right away and builds the voice in the background,
    so the list does not wait on the persona creation call."""
    name = " ".join(body.name.split())
    link = _clean_link(body.link)
    current = admired_list(db, sketcher_id)
    if any((p.admired_artist_name or "").lower() == name.lower() for p in current):
        raise HTTPException(409, f"{name} is already on your list.")
    if len(current) >= MAX_ADMIRED:
        raise HTTPException(422, f"Your list holds at most {MAX_ADMIRED} sketchers.")
    persona = Persona(
        sketcher_id=sketcher_id,
        style=None,
        admired_artist_name=name,
        persona_source="sketcher_provided",
        persona_label=name,
        admired_link=link,
        admired_location=(body.location or "").strip()[:80] or None,
        # Empty until build_admired_voice fills them in.
        voice="",
        priorities=[],
        tone="",
    )
    db.add(persona)
    db.commit()
    db.refresh(persona)
    background_tasks.add_task(build_admired_voice, persona.id)
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

