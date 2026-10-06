"""
POST /api/scene-analysis: the scene analysis call, photo only (design doc,
Section 5; schema: gemini_call_schemas.md #1).

New Sketch fires it as soon as the sketcher confirms the crop, so it runs
while they draw marks. It reads the saved framed photo; the browser sends
only the sketch id. Marks and style are not part of it.

HTTP layer only: auth, caching, loading the photo, saving the scene facts,
title and EXIF location on the sketch. The Gemini call is in service.py.

Cache: the result is stored in sketch.cached_scene_analysis with the
photo's fingerprint (service.photo_fingerprint: photo + framing). The
marks analysis result is kept inside the same dict, under "marks_analysis",
and is cleared with it when the photo or framing changes.
"""
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException
from PIL import Image
import pillow_heif
from sqlalchemy.orm import Session
from geoalchemy2.elements import WKTElement

from config import DEBUG
from app.core.auth import get_current_sketcher_id
from app.core.database import get_db
from app.core.exif_utils import extract_location_and_time
from app.core.gemini_service import GeminiQuotaExceededError
from app.core.models import Sketch
from app.core.paths import UPLOAD_DIR
from app.features.geocode.service import reverse_geocode
from app.features.scene_analysis import service
from app.features.scene_analysis.schemas import SceneAnalysisResponse

pillow_heif.register_heif_opener()

router = APIRouter(prefix="/api", tags=["scene-analysis"])


def cached_scene(sketch) -> dict | None:
    """The cached scene analysis when it matches the sketch's current photo
    and framing, else None."""
    cached = sketch.cached_scene_analysis
    if cached and cached.get("photo_fingerprint") == service.photo_fingerprint(sketch):
        return cached
    return None


@router.post("/scene-analysis", response_model=SceneAnalysisResponse)
async def scene_analysis(
    sketch_id: str = Form(...),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    sketch = db.query(Sketch).filter(Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")

    cached = cached_scene(sketch)
    if cached:
        return cached

    if not sketch.reference_image_url:
        raise HTTPException(400, "This sketch has no reference photo on file")
    fingerprint = service.photo_fingerprint(sketch)
    try:
        pil_image = Image.open(UPLOAD_DIR / Path(sketch.reference_image_url).name).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not load this sketch's photo")

    location, captured_at = extract_location_and_time(pil_image)
    pil_image = service.resize_if_needed(pil_image)

    try:
        result, raw_gemini_text = service.analyze(pil_image, sketch.crop_transform)
    except GeminiQuotaExceededError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    result["photo_fingerprint"] = fingerprint

    # The sketcher may have reframed while the call ran. Then this result
    # belongs to the old frame: return it, but don't store it.
    db.refresh(sketch)
    if service.photo_fingerprint(sketch) != fingerprint:
        return {**result, "debug_raw_gemini_response": raw_gemini_text if DEBUG else None}

    # Fill a missing title from the AI's suggestion, so the sketch isn't
    # "Untitled sketch" on the home feed mid-flow. Never overwrites one.
    suggested_title = (result.get("suggested_title") or "").strip()
    if suggested_title and not sketch.title:
        sketch.title = suggested_title[:150]

    sketch.scene_type = result["scene_type"]
    sketch.cached_scene_analysis = result
    if location:
        # Resolve a label only the first time a location is set, so a
        # re-analysis never clobbers one the sketcher already has.
        sketch.location = WKTElement(f"POINT({location['lon']} {location['lat']})", srid=4326)
        if not sketch.location_label:
            label = await reverse_geocode(location["lat"], location["lon"])
            if label:
                sketch.location_label = label[:200]
    if captured_at:
        sketch.captured_at = captured_at
    db.commit()

    return {**result, "debug_raw_gemini_response": raw_gemini_text if DEBUG else None}
