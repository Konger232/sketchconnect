"""
Critique agent call (schema: gemini_call_schemas.md #3).

Runs in the background. It starts on its own when the sketcher uploads a
final sketch (POST /api/sketches/{id}/final-sketch), or on demand via
POST /api/critique (e.g. a retry after a failure). The frontend polls the
sketch's `critique_status` ('pending' | 'done' | 'failed') for the result.

The whole journey is read from the database, not the request: guided
answers (sketches.session_choices), Help Quest history (help_quest_log),
the latest prior review, the sketcher's focal points and planning marks,
and up to three images, in this order (services/composite.py):
  1. the untouched original photo -- always
  2. the planning image: framed photo + focal points + planning marks --
     only when the sketcher reframed, marked focal points or drew marks
     (render_composite returns None otherwise, and it isn't sent)
  3. the final sketch, when uploaded
Together they show what was in front of the sketcher, what they chose to
frame and plan, and what they drew.
"""
import json
import logging
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException
from PIL import Image
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..auth import get_current_sketcher_id
from ..models import Sketch, Persona, CritiqueResponse, HelpQuestLog
from ..services.gemini_client import call_gemini_json
from ..services.composite import (
    COMPOSITE_EXPLANATION,
    describe_focal_points,
    load_original,
    render_composite,
    summarize_marks,
    was_reframed,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["critique"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"

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


def start_critique(db: Session, sketch: Sketch, background_tasks: BackgroundTasks) -> None:
    """Mark the sketch as pending and queue the critique call."""
    sketch.critique_status = "pending"
    db.commit()
    background_tasks.add_task(_run_critique_in_background, sketch.id)


def _run_critique_in_background(sketch_id: str) -> None:
    """
    Runs after the response is sent, in FastAPI's threadpool (plain def).
    Opens its own DB session, since the request's session is already closed.
    """
    db = SessionLocal()
    try:
        sketch = db.query(Sketch).filter(Sketch.id == sketch_id).first()
        if sketch is None:
            return  # deleted while queued
        try:
            _run_critique(db, sketch)
            sketch.critique_status = "done"
        except Exception:
            logger.exception("Critique call failed for sketch %s", sketch_id)
            db.rollback()
            sketch.critique_status = "failed"
        db.commit()
    finally:
        db.close()


def _run_critique(db: Session, sketch: Sketch) -> None:
    """Build the journey from the database, call Gemini, store the result."""
    persona = (
        db.query(Persona)
        .filter(Persona.sketcher_id == sketch.sketcher_id, Persona.style == sketch.style)
        .first()
    )
    if persona is None:
        raise RuntimeError("No persona set for this style yet")

    session_choices = json.dumps(sketch.session_choices or [])
    help_quest_log = json.dumps([
        {"step_id": h.step_id, "question": h.question, "answer": h.answer,
         "principle_reference": h.principle_reference}
        for h in db.query(HelpQuestLog)
        .filter(HelpQuestLog.sketch_id == sketch.id)
        .order_by(HelpQuestLog.created_at)
    ])
    latest = (
        db.query(CritiqueResponse)
        .filter(CritiqueResponse.sketch_id == sketch.id)
        .order_by(CritiqueResponse.created_at.desc())
        .first()
    )
    prior_review_summary = latest.critique if latest else None

    final_image = None
    if sketch.final_sketch_url:
        final_image = Image.open(UPLOAD_DIR / Path(sketch.final_sketch_url).name).convert("RGB")

    original = load_original(sketch)                # untouched upload
    composite = render_composite(sketch)            # None if no planning at all

    images, image_notes = [], []
    if original is not None:
        images.append(original)
        image_notes.append(
            f"Image {len(images)} is the untouched original photo of the scene, before "
            "the sketcher cropped or reframed it."
        )
    if composite is not None:
        images.append(composite)
        framing = (
            "the sketcher's chosen framing of that photo"
            if was_reframed(sketch)
            else "the same photo (framing unchanged)"
        )
        image_notes.append(f"Image {len(images)} is {framing}, their planning image. {COMPOSITE_EXPLANATION}")
    if final_image is not None:
        images.append(final_image)
        image_notes.append(f"Image {len(images)} is the sketcher's final sketch.")
    images_text = " ".join(image_notes) if image_notes else "No images are attached."

    prompt = (
        f"You are critiquing an urban sketcher's journey, speaking in the voice of "
        f"persona '{persona.persona_label}' ({persona.voice}, tone: {persona.tone}), "
        f"prioritizing: {', '.join(persona.priorities)}. Scene type: {sketch.scene_type or 'unknown'}, "
        f"style: {sketch.style}. Evaluate the whole journey — the choices made along the "
        f"way and where the sketcher needed outside help — not just the final image "
        f"in isolation. {images_text} "
        f"Focal points the sketcher marked: {describe_focal_points(sketch.focal_points)}. "
        f"Planning marks: {summarize_marks(sketch.marks)}. "
        f"Compare the scene, the plan (framing, focal points, marks) and what the "
        f"final sketch actually did, where each is attached. "
        f"Session choices: {session_choices}. Help Quest history: "
        f"{help_quest_log}. Prior review summary: {prior_review_summary or 'none — first critique this session'}. "
        f"Keep `critique` under ~200 words and never tell the sketcher what to draw next."
    )

    result = call_gemini_json(prompt, RESPONSE_SCHEMA, images, mock_name="critique")

    db.add(CritiqueResponse(
        sketch_id=sketch.id,
        sketcher_id=sketch.sketcher_id,
        decision_trace=result["decision_trace"],
        critique=result["critique"],
        prior_review_summary=result["prior_review_summary"],
        final_sketch_provided=final_image is not None,
    ))


@router.post("/critique")
async def critique(
    background_tasks: BackgroundTasks,
    sketch_id: str = Form(...),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """Start (or retry) the critique call for a sketch. Returns right away."""
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")
    if sketch.critique_status == "pending":
        return {"critique_status": "pending"}
    start_critique(db, sketch, background_tasks)
    return {"critique_status": "pending"}
