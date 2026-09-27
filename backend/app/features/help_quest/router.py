"""
POST /api/help-quest — fires on demand, unbounded times per session
(schema: gemini_call_schemas.md #4). Stateless per call; the stored log
feeds the *next* Critique Agent call, not the next Help Quest call.

HTTP layer and the stored log. The image choice, prompt and Gemini call are
in features/help_quest/service.py (prompt text: prompts/help_quest*.md). An
uploaded `image` is only a fallback for a sketch with no photo on disk.
"""
import io

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from PIL import Image
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_sketcher_id
from app.core.models import HelpQuestLog, Sketch
from app.features.help_quest.schemas import HelpQuestResponse
from app.features.help_quest import service as help_quest_service

router = APIRouter(prefix="/api", tags=["help-quest"])

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
    pil_image, has_plan = help_quest_service.pick_image(sketch)
    if pil_image is None and image is not None:
        contents = await image.read()
        try:
            pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
        except Exception:
            raise HTTPException(400, "Could not decode image")
    if pil_image is None:
        raise HTTPException(400, "This sketch has no reference photo yet")

    result = help_quest_service.ask(
        sketch, pil_image, has_plan,
        question=question, style=style, scene_type=scene_type, step_id=step_id,
    )

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
