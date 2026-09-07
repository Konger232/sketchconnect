"""
POST /api/critique — sketcher opt-in, may fire more than once per session
(schema: gemini_call_schemas.md #3). `persona` is passed in as cached
context from the Persona Creation call, never regenerated here.
"""
import io

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from PIL import Image
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_sketcher_id
from ..models import Sketch, Persona, CritiqueResponse
from ..schemas import CritiqueResponseOut
from ..services.gemini_client import call_gemini_json
import json

router = APIRouter(prefix="/api", tags=["critique"])

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "prior_review_summary": {"type": "string"},
        "decision_trace": {
            "type": "object",
            "properties": {
                "carried_through": {"type": "array", "items": {"type": "string"}},
                "shifted": {"type": "array", "items": {"type": "string"}},
                "instinct_only": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["carried_through", "shifted", "instinct_only"],
        },
        "critique": {"type": "string"},
        "final_sketch_provided": {"type": "boolean"},
    },
    "required": ["prior_review_summary", "decision_trace", "critique", "final_sketch_provided"],
}


@router.post("/critique", response_model=CritiqueResponseOut)
async def critique(
    sketch_id: str = Form(...),
    style: str = Form(...),
    scene_type: str = Form(...),
    session_choices: str = Form("[]"),       # JSON-encoded list, multipart-safe
    help_quest_log: str = Form("[]"),        # JSON-encoded list
    prior_review_summary: str | None = Form(None),
    final_sketch: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    persona = (
        db.query(Persona)
        .filter(Persona.sketcher_id == sketcher_id, Persona.style == style)
        .first()
    )
    if persona is None:
        raise HTTPException(400, "No persona set for this style yet — call /api/persona first")

    final_image = None
    final_sketch_provided = False
    if final_sketch is not None:
        contents = await final_sketch.read()
        try:
            final_image = Image.open(io.BytesIO(contents)).convert("RGB")
            final_sketch_provided = True
        except Exception:
            raise HTTPException(400, "Could not decode final sketch image")

    prompt = (
        f"You are critiquing an urban sketcher's journey, speaking in the voice of "
        f"persona '{persona.persona_label}' ({persona.voice}, tone: {persona.tone}), "
        f"prioritizing: {', '.join(persona.priorities)}. Scene type: {scene_type}, "
        f"style: {style}. Evaluate the whole journey — the choices made along the "
        f"way and where the sketcher needed outside help — not just the final image "
        f"in isolation. Session choices: {session_choices}. Help Quest history: "
        f"{help_quest_log}. Prior review summary: {prior_review_summary or 'none — first critique this session'}. "
        f"Keep `critique` under ~200 words and never tell the sketcher what to draw next."
    )

    result = call_gemini_json(prompt, RESPONSE_SCHEMA, final_image)
    result["final_sketch_provided"] = final_sketch_provided

    row = CritiqueResponse(
        sketch_id=sketch_id,
        sketcher_id=sketcher_id,
        decision_trace=result["decision_trace"],
        critique=result["critique"],
        prior_review_summary=result["prior_review_summary"],
        final_sketch_provided=final_sketch_provided,
    )
    db.add(row)
    db.commit()

    return result
