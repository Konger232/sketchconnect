"""
POST /api/help-quest — fires on demand, unbounded times per session
(schema: gemini_call_schemas.md #4). Stateless per call; the stored log
feeds the *next* Critique Agent call, not the next Help Quest call.
"""
import io

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from PIL import Image
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_sketcher_id
from ..models import HelpQuestLog
from ..schemas import HelpQuestResponse
from ..services.gemini_client import call_gemini_json

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
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    contents = await image.read()
    try:
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not decode image")

    prompt = (
        f"An urban sketcher, mid-session on a '{scene_type}' scene in '{style}' style, "
        f"asks: \"{question}\" (currently on screen: {step_id}). Answer grounded in "
        "the Elements and Principles of Design (UC Berkeley Library guide). Never say "
        "what to draw — only ground the answer in a design principle. Keep it short, "
        "a nudge, not a lecture."
    )

    result = call_gemini_json(prompt, RESPONSE_SCHEMA, pil_image)

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
