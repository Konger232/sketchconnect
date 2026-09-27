"""
Critique agent call (schema: gemini_call_schemas.md #3).

Reads the whole journey from the database -- guided answers
(sketches.session_choices), Help Quest history (help_quest_log), the latest
prior review, the sketcher's focal points and planning marks -- and sends
up to three images, in this order (core/composite.py):
  1. the untouched original photo -- always
  2. the planning image: framed photo + focal points + planning marks --
     only when the sketcher reframed, marked focal points or drew marks
  3. the final sketch, when uploaded

Prompt text: prompts/critique_agent.md plus one prompts/*_image.md or
final_sketch.md sentence per attached image. Starting
the call, running it in the background and the HTTP route stay in
features/critique_agent/router.py.
"""
import json
from pathlib import Path

from PIL import Image
from sqlalchemy.orm import Session

from app.core.models import Sketch, Persona, CritiqueResponse, HelpQuestLog
from app.core.prompt_loader import render_prompt
from app.core.composite import (
    describe_focal_points,
    load_original,
    render_composite,
    summarize_marks,
    was_reframed,
)
from app.core.gemini_service import call_gemini_json
from app.core.paths import UPLOAD_DIR

PROMPTS = Path(__file__).parent / "prompts"


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



def run_critique(db: Session, sketch: Sketch) -> None:
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

    planning_image = render_prompt("planning_image.md")
    images, image_notes = [], []
    if original is not None:
        images.append(original)
        image_notes.append(render_prompt(PROMPTS / "original_image.md", n=len(images)))
    if composite is not None:
        images.append(composite)
        note = PROMPTS / ("reframed_image.md" if was_reframed(sketch) else "unchanged_image.md")
        image_notes.append(render_prompt(note, n=len(images), planning_image=planning_image))
    if final_image is not None:
        images.append(final_image)
        image_notes.append(render_prompt(PROMPTS / "final_sketch.md", n=len(images)))

    prompt = render_prompt(
        PROMPTS / "critique_agent.md",
        persona_label=persona.persona_label,
        persona_voice=persona.voice,
        persona_tone=persona.tone,
        persona_priorities=", ".join(persona.priorities),
        scene_type=sketch.scene_type or "unknown",
        style=sketch.style,
        images=" ".join(image_notes) if image_notes else render_prompt(PROMPTS / "no_image.md"),
        focal_points=describe_focal_points(sketch.focal_points),
        marks=summarize_marks(sketch.marks),
        session_choices=session_choices,
        help_quest_log=help_quest_log,
        prior_review_summary=prior_review_summary or "none — first critique this session",
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

