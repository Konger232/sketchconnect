"""
POST /api/help-quest — fires on demand, unbounded times per session
(schema: gemini_call_schemas.md #4). Stateless per call; the stored log
feeds the *next* Critique Agent call, not the next Help Quest call.

The image is built here from the saved sketch (services/composite.py): the
framed reference photo with the sketcher's focal points and planning marks
drawn on, plus a text summary of both -- so the answer can speak to their
plan. An uploaded `image` is only a fallback for a sketch with no reference
photo on disk.
"""
import io

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from PIL import Image
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_sketcher_id
from ..models import HelpQuestLog, Sketch
from ..schemas import HelpQuestResponse
from ..services.gemini_client import call_gemini_json
from ..services.composite import (
    COMPOSITE_EXPLANATION,
    describe_focal_points,
    load_original,
    render_composite,
    summarize_marks,
)

router = APIRouter(prefix="/api", tags=["help-quest"])

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "principle_reference": {"type": "string"},
    },
    "required": ["answer", "principle_reference"],
}


@router.post("/help-quest", response_model=HelpQuestResponse)
async def help_quest(
    sketch_id: str = Form(...),
    question: str = Form(...),
    style: str = Form(...),
    scene_type: str = Form(...),
    step_id: str = Form(...),
    image: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")

    # The planning image when there is one; otherwise the plain photo
    # (Help Quest always needs something to look at).
    composite = render_composite(sketch)
    pil_image = composite if composite is not None else load_original(sketch)
    if pil_image is None and image is not None:
        contents = await image.read()
        try:
            pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
        except Exception:
            raise HTTPException(400, "Could not decode image")
    if pil_image is None:
        raise HTTPException(400, "This sketch has no reference photo yet")

    prompt = (
        f"An urban sketcher, mid-session on a '{scene_type}' scene in '{style}' style, "
        f"asks: \"{question}\" (currently on screen: {step_id}). "
        + (
            f"{COMPOSITE_EXPLANATION} "
            f"Focal points they marked: {describe_focal_points(sketch.focal_points)}. "
            f"Planning marks: {summarize_marks(sketch.marks)}. Where it helps, relate the "
            "answer to their own focal points and marks. "
            if composite is not None
            else "The image is their reference photo; they haven't marked a plan on it. "
        )
        + "Answer grounded in "
        "the Elements and Principles of Design (UC Berkeley Library guide). Never say "
        "what to draw — only ground the answer in a design principle. Keep it short, "
        "a nudge, not a lecture."
    )

    result = call_gemini_json(prompt, RESPONSE_SCHEMA, pil_image, mock_name="help_quest")

    db.add(HelpQuestLog(
        sketch_id=sketch_id,
        sketcher_id=sketcher_id,
        step_id=step_id,
        question=question,
        answer=result["answer"],
        principle_reference=result.get("principle_reference"),
    ))
    db.commit()

    return result
