"""
POST /api/marks-analysis: the marks analysis call (design doc, Section 11,
item 20). Fires when the sketcher finishes the Marks step in New Sketch,
and again when the marks or the selection change before Start Sketching.
It drives every guided question.

HTTP layer only: auth, caching, loading the photo. The marks and the scene
facts are read from the stored sketch, never sent from the browser. The
Gemini call itself is in service.py; the prompt is in prompts/marks_analysis.md.

Needs the scene analysis (photo only) for the sketch's current photo and
framing. New Sketch starts that call when the crop is confirmed and waits
for it before calling this one; without it this returns 409.

Cache: the cleaned result is stored inside the sketch's
cached_scene_analysis, under "marks_analysis". A new scene analysis (new
photo or framing) replaces that dict, which also clears this cache.
"""
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException
from PIL import Image
import pillow_heif
from sqlalchemy.orm import Session

from config import COACHING_MAX_DIMENSION, DEBUG
from app.core.auth import get_current_sketcher_id
from app.core.database import get_db
from app.core.gemini_service import GeminiQuotaExceededError
from app.core.models import Sketch
from app.core.paths import UPLOAD_DIR
from app.features.marks_analysis import service
from app.features.marks_analysis.schemas import MarksAnalysisResponse
from app.features.scene_analysis import service as scene_service
from app.features.scene_analysis.router import cached_scene

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
    scene = cached_scene(sketch)
    if scene is None:
        raise HTTPException(409, "Run the scene analysis first")

    # Cache hit: no plan image, no photo load.
    fingerprint = service.fingerprint(sketch, scene)
    cached = scene.get(CACHE_KEY) or {}
    if cached.get("fingerprint") == fingerprint and "cleaned" in cached:
        return service.assemble(cached["cleaned"], sketch, scene, service.selected_mark_ids(sketch))

    if not sketch.reference_image_url:
        raise HTTPException(400, "This sketch has no reference photo on file")
    try:
        photo = Image.open(UPLOAD_DIR / Path(sketch.reference_image_url).name).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not load this sketch's photo")
    photo = scene_service.resize_if_needed(photo)
    # The plan image is drawn on the photo already loaded, at coaching size
    # (as render_composite does), not loaded from disk a second time.
    plan = service.build_plan(sketch, scene_service.resize_if_needed(photo, COACHING_MAX_DIMENSION))

    try:
        cleaned, raw_text = service.analyze(photo, sketch, scene, plan)
    except GeminiQuotaExceededError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    # Assign a new dict. SQLAlchemy doesn't detect in-place edits to a JSON column.
    sketch.cached_scene_analysis = {**scene, CACHE_KEY: {"fingerprint": fingerprint, "cleaned": cleaned}}
    db.commit()

    result = service.assemble(cleaned, sketch, scene, plan.selected_ids)
    result["debug_raw_gemini_response"] = raw_text if DEBUG else None
    return result
