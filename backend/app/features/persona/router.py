"""
POST /api/persona — fires once, from Settings, when a sketcher sets or
changes their admired artist for a style (schema: gemini_call_schemas.md #2).
Result is stored and reused by every later critique call for that style
until changed again — never regenerated per-critique.

HTTP layer and storage only; the Gemini call is in features/persona/service.py.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_sketcher_id
from app.core.models import Persona
from app.features.persona.schemas import PersonaCreateRequest, PersonaResponse
from app.core import rules
from app.features.persona.service import generate_persona

router = APIRouter(prefix="/api", tags=["persona"])


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
