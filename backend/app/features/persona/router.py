"""
Admired sketchers (design doc, item 36, October 17, 2026): a list of names
on the sketcher page, visible only to the sketcher. Adding a name runs the
persona creation call once and stores the persona; the critique reuses it
whenever the sketcher picks that voice for a final sketch.

GET    /api/admired              the list, oldest first
POST   /api/admired              add a name (at most MAX_ADMIRED)
DELETE /api/admired/{persona_id} remove one; sketches that used it fall
                                 back to the default coach

POST /api/persona — the older one-artist-per-style route. Kept until the
Settings page is removed (item 36).

POST /api/persona — fires once, from Settings, when a sketcher sets or
changes their admired artist for a style (schema: gemini_call_schemas.md #2).
Result is stored and reused by every later critique call for that style
until changed again — never regenerated per-critique.

HTTP layer and storage only; the Gemini call is in features/persona/service.py.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_sketcher_id
from app.core.models import Persona
from app.features.persona.schemas import AdmiredAddRequest, PersonaCreateRequest, PersonaResponse
from app.core import rules
from app.features.persona.service import generate_admired_persona, generate_persona

router = APIRouter(prefix="/api", tags=["persona"])

MAX_ADMIRED = 5


def admired_to_dict(p: Persona) -> dict:
    return {"id": p.id, "name": p.admired_artist_name, "persona_label": p.persona_label}


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


@router.post("/persona", response_model=PersonaResponse)
async def create_persona(
    body: PersonaCreateRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    try:
        rules.validate_style(body.style)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    result = generate_persona(body.style, body.admired_artist_name)

    persona = (
        db.query(Persona)
        .filter(Persona.sketcher_id == sketcher_id, Persona.style == body.style)
        .first()
    )
    if persona is None:
        persona = Persona(sketcher_id=sketcher_id, style=body.style)
        db.add(persona)

    persona.admired_artist_name = body.admired_artist_name
    persona.persona_source = result["persona_source"]
    persona.persona_label = result["persona_label"]
    persona.voice = result["voice"]
    persona.priorities = result["priorities"]
    persona.tone = result["tone"]
    db.commit()

    return result
