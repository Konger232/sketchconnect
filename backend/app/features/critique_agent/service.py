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
from types import SimpleNamespace

from PIL import Image
from sqlalchemy.orm import Session

from app.core import debug
from app.core.models import Sketch, Persona, CritiqueResponse, HelpQuestLog
from app.core.prompt_loader import render_prompt
from app.core.composite import (
    describe_focal_points,
    load_original,
    render_composite,
    summarize_marks,
    summarize_revisions,
    was_reframed,
)
from app.core.gemini_service import call_gemini_json
from app.core.paths import UPLOAD_DIR
from app.features.persona.service import generate_persona
from app.features.scene_analysis import question_bank

PROMPTS = Path(__file__).parent / "prompts"

# Most recent Help Quest Q&As included in the critique prompt.
HELP_QUEST_HISTORY_LIMIT = 10


# Habits and opportunities (design doc, Section 11, item 15).
MAX_HABITS = 3
MAX_OPPORTUNITIES = 2
# Where a habit or opportunity came from. Scenarios per value: design doc,
# Section 11, item 15, "Evidence".
EVIDENCE = ["plan", "prompted", "instinct", "stages"]


def principles() -> list[str]:
    """The Berkeley elements and principles, from the question bank."""
    return question_bank.load_bank()["principles"]


def response_schema() -> dict:
    """
    Built per call, so the principle enum follows question_bank.json. The
    caps (MAX_HABITS, MAX_OPPORTUNITIES) are stated in the prompt and
    applied by clean_trace, not sent as maxItems.
    """
    def trace_list() -> dict:
        return {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "observation": {"type": "string"},
                    "principle": {"type": "string", "enum": principles()},
                    "evidence": {"type": "string", "enum": EVIDENCE},
                },
                "required": ["observation", "principle", "evidence"],
            },
        }

    return {
        "type": "object",
        "properties": {
            "prior_review_summary": {"type": "string"},
            "decision_trace": {
                "type": "object",
                "properties": {
                    "habits": trace_list(),
                    "opportunities": trace_list(),
                },
                "required": ["habits", "opportunities"],
            },
            "critique": {"type": "string"},
            "final_sketch_provided": {"type": "boolean"},
        },
        "required": ["prior_review_summary", "decision_trace", "critique", "final_sketch_provided"],
    }


def clean_trace(raw: dict | None) -> dict:
    """
    Keeps only well-formed items, within the caps, with a known principle
    and evidence. The schema already asks for this; this makes sure a
    stored row always has the shape the app reads.
    """
    allowed = set(principles())

    def clean(items, cap):
        out = []
        for item in items or []:
            if not isinstance(item, dict):
                continue
            text = (item.get("observation") or "").strip()
            principle = (item.get("principle") or "").strip().lower()
            evidence = (item.get("evidence") or "").strip().lower()
            if text and principle in allowed and evidence in EVIDENCE:
                out.append({"observation": text, "principle": principle, "evidence": evidence})
        return out[:cap]

    raw = raw or {}
    return {
        "habits": clean(raw.get("habits"), MAX_HABITS),
        "opportunities": clean(raw.get("opportunities"), MAX_OPPORTUNITIES),
    }



# Last resort when there's no persona and the default can't be generated
# either: a plain, encouraging coach, so feedback still arrives.
# A plain object, not a Persona row, so it can never be saved by accident.
GENERIC_PERSONA = SimpleNamespace(
    persona_source="system_default",
    persona_label="Urban sketching coach",
    voice="Warm and practical. Speaks like a fellow sketcher looking over your shoulder.",
    priorities=["composition", "proportion", "value", "line confidence"],
    tone="Encouraging. Names what worked before one or two things to try next.",
)


def _persona_for(db: Session, sketch: Sketch) -> Persona | SimpleNamespace:
    """
    The sketcher's persona for this sketch's style. With no admired artist
    set for the style, the style's system default is generated once and
    stored, the same row Settings updates later (persona/router.py). If that
    call fails, GENERIC_PERSONA is used for this critique and nothing is
    stored, so the next critique tries again.
    """
    persona = (
        db.query(Persona)
        .filter(Persona.sketcher_id == sketch.sketcher_id, Persona.style == sketch.style)
        .first()
    )
    if persona is not None:
        return persona
    if not sketch.style:
        return GENERIC_PERSONA
    try:
        result = generate_persona(sketch.style, None)
    except Exception as exc:
        print(f"[critique] default persona for {sketch.style} failed ({exc}); using the generic coach")
        return GENERIC_PERSONA
    persona = Persona(
        sketcher_id=sketch.sketcher_id,
        style=sketch.style,
        admired_artist_name=None,
        persona_source="system_default",
        persona_label=result["persona_label"],
        voice=result["voice"],
        priorities=result["priorities"],
        tone=result["tone"],
    )
    db.add(persona)
    db.commit()
    print(f"[critique] no admired artist for {sketch.style}; stored the default persona '{persona.persona_label}'")
    return persona


def run_critique(db: Session, sketch: Sketch) -> None:
    """Build the journey from the database, call Gemini, store the result."""
    persona = _persona_for(db, sketch)

    session_choices = json.dumps(sketch.session_choices or [])
    # Only the most recent Help Quest exchanges, oldest first, so a long
    # session doesn't keep growing the prompt.
    recent_help = (
        db.query(HelpQuestLog)
        .filter(HelpQuestLog.sketch_id == sketch.id)
        .order_by(HelpQuestLog.created_at.desc())
        .limit(HELP_QUEST_HISTORY_LIMIT)
        .all()
    )
    help_quest_log = json.dumps([
        {"step_id": h.step_id, "question": h.question, "answer": h.answer,
         "principle_reference": h.principle_reference}
        for h in reversed(recent_help)
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

    debug.print_marks("critique", sketch.id, sketch.marks, (sketch.cached_scene_analysis or {}).get("frame_aspect", 1.0))
    prompt = render_prompt(
        PROMPTS / "critique_agent.md",
        persona_label=persona.persona_label,
        persona_voice=persona.voice,
        persona_tone=persona.tone,
        persona_priorities=", ".join(persona.priorities),
        scene_type=sketch.scene_type or "unknown",
        style=sketch.style or "unspecified",
        images=" ".join(image_notes) if image_notes else render_prompt(PROMPTS / "no_image.md"),
        focal_points=describe_focal_points(sketch.focal_points),
        marks=summarize_marks(sketch.marks),
        revisions=summarize_revisions(sketch.marks),
        session_choices=session_choices,
        help_quest_log=help_quest_log,
        prior_review_summary=prior_review_summary or "none — first critique this session",
        principles=", ".join(principles()),
    )

    result = call_gemini_json(prompt, response_schema(), images, mock_name="critique")
    result["decision_trace"] = clean_trace(result.get("decision_trace"))

    db.add(CritiqueResponse(
        sketch_id=sketch.id,
        sketcher_id=sketch.sketcher_id,
        decision_trace=result["decision_trace"],
        critique=result["critique"],
        prior_review_summary=result["prior_review_summary"],
        final_sketch_provided=final_image is not None,
    ))

