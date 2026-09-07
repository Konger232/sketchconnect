"""
POST /api/persona — fires once, from Settings, when a sketcher sets or
changes their admired artist for a style (schema: gemini_call_schemas.md #2).
Result is stored and reused by every later critique call for that style
until changed again — never regenerated per-critique.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_sketcher_id
from ..models import Persona
from ..schemas import PersonaCreateRequest, PersonaResponse
from ..services.gemini_client import call_gemini_json
from ..services import rules

router = APIRouter(prefix="/api", tags=["persona"])

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "persona_source": {"type": "string", "enum": ["sketcher_provided", "system_default"]},
        "persona_label": {"type": "string"},
        "voice": {"type": "string"},
        "priorities": {"type": "array", "items": {"type": "string"}},
        "tone": {"type": "string"},
    },
    "required": ["persona_source", "persona_label", "voice", "priorities", "tone"],
}


def _build_prompt(style: str, admired_artist_name: str | None) -> str:
    if admired_artist_name:
        return (
            f"Describe a critique persona modeled after {admired_artist_name}'s known "
            f"teaching style or public commentary, for critiquing '{style}'-style urban "
            "sketches. Return persona_source='sketcher_provided'."
        )
    return (
        f"Describe a default critique persona for the '{style}' urban sketching style, "
        "grounded in that style's named source in the urban sketching literature. "
        "Return persona_source='system_default'."
    )


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

    result = call_gemini_json(_build_prompt(body.style, body.admired_artist_name), RESPONSE_SCHEMA)

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
