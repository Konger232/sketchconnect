"""
POST /api/marks-analysis: the marks analysis call (design doc, Section 11,
item 20). Fires after the scene analysis call in New Sketch, and again
when the marks or the selection change before Start Sketching.

HTTP layer only: auth, caching, loading the photo. The marks and the scene
facts are read from the stored sketch, never sent from the browser. The
Gemini call itself is in service.py; the prompt is in prompts/marks_analysis.md.

Cache: during the parallel run the cleaned result is stored inside the
sketch's cached_scene_analysis, under "marks_analysis", so no new column is
needed. A new scene analysis replaces that dict, which also clears this
cache. That is right: this call builds on the scene analysis.
"""
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException
from PIL import Image
import pillow_heif
from sqlalchemy.orm import Session

from config import DEBUG
from app.core.auth import get_current_sketcher_id
from app.core.database import get_db
from app.core.gemini_service import GeminiQuotaExceededError
from app.core.models import Sketch
from app.core.paths import UPLOAD_DIR
from app.features.marks_analysis import service
from app.features.marks_analysis.schemas import MarksAnalysisResponse
from app.features.scene_analysis import service as scene_service

pillow_heif.register_heif_opener()

router = APIRouter(prefix="/api", tags=["marks-analysis"])

CACHE_KEY = "marks_analysis"


@router.post("/marks-analysis", response_model=MarksAnalysisResponse)
async def marks_analysis(
    sketch_id: str = Form(...),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    sketch = db.query(Sketch).filter(Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")
    scene = sketch.cached_scene_analysis
    if not scene or not sketch.style:
        raise HTTPException(409, "Run the scene analysis first")

    plan = service.build_plan(sketch)
    fingerprint = service.fingerprint(sketch, scene)
    cached = scene.get(CACHE_KEY) or {}
    if cached.get("fingerprint") == fingerprint and "cleaned" in cached:
        return service.assemble(cached["cleaned"], sketch, scene, plan.selected_ids)

    if not sketch.reference_image_url:
        raise HTTPException(400, "This sketch has no reference photo on file")
    try:
        photo = Image.open(UPLOAD_DIR / Path(sketch.reference_image_url).name).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not load this sketch's photo")
    photo = scene_service.resize_if_needed(photo)

    try:
        cleaned, raw_text = service.analyze(photo, sketch, scene, sketch.style, plan)
    except GeminiQuotaExceededError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    # Assign a new dict. SQLAlchemy doesn't detect in-place edits to a JSON column.
    sketch.cached_scene_analysis = {**scene, CACHE_KEY: {"fingerprint": fingerprint, "cleaned": cleaned}}
    db.commit()

    result = service.assemble(cleaned, sketch, scene, plan.selected_ids)
    result["debug_raw_gemini_response"] = raw_text if DEBUG else None
    return result
