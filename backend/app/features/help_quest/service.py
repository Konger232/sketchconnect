"""
Help Quest call (schema: gemini_call_schemas.md #4). Fires on demand,
unbounded times per session; stateless per call.

The image is the planning image when the sketcher did any planning (framed
photo + focal points + planning marks, core/composite.py), otherwise
the plain original photo. Prompt text: prompts/help_quest*.md. The HTTP
route and the stored log stay in features/help_quest/router.py.
"""
from pathlib import Path

from PIL import Image

from app.core import debug
from app.core.prompt_loader import render_prompt
from config import COACHING_MAX_DIMENSION
from app.core.composite import (
    describe_focal_points,
    load_original,
    render_composite,
    summarize_marks,
)
from app.core.gemini_service import call_gemini_json

PROMPTS = Path(__file__).parent / "prompts"

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "principle_reference": {"type": "string"},
    },
    "required": ["answer", "principle_reference"],
}



def pick_image(sketch) -> tuple[Image.Image | None, bool]:
    """(image to send, whether it's the planning image)."""
    composite = render_composite(sketch)
    if composite is not None:
        return composite, True
    return load_original(sketch, COACHING_MAX_DIMENSION), False


def build_prompt(sketch, question: str, style: str, scene_type: str, step_id: str, has_plan: bool) -> str:
    if has_plan:
        debug.print_marks("help_quest", sketch.id, sketch.marks, (sketch.cached_scene_analysis or {}).get("frame_aspect", 1.0))
        plan_context = render_prompt(
            PROMPTS / "help_quest_plan.md",
            planning_image=render_prompt("planning_image.md"),
            focal_points=describe_focal_points(sketch.focal_points),
            marks=summarize_marks(sketch.marks),
        )
    else:
        plan_context = render_prompt(PROMPTS / "help_quest_no_plan.md")
    return render_prompt(
        PROMPTS / "help_quest.md",
        scene_type=scene_type,
        style=style,
        question=question,
        step_id=step_id,
        plan_context=plan_context,
    )


def ask(sketch, image: Image.Image, has_plan: bool, question: str, style: str, scene_type: str, step_id: str) -> dict:
    prompt = build_prompt(sketch, question, style, scene_type, step_id, has_plan)
    return call_gemini_json(prompt, RESPONSE_SCHEMA, image, mock_name="help_quest")
