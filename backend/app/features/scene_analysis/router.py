"""
POST /api/scene-analysis — fires once per reference photo (design doc,
Section 5, steps 1-4; schema: gemini_call_schemas.md #1).

HTTP layer only: auth, caching, loading the photo, and saving results on
the sketch. The sketcher's plan (focal points, marks) is read from the
stored sketch, never sent from the browser. The Gemini call itself (schema, prompt, result cleaning) is in
features/scene_analysis/service.py; the prompt text is in prompts/scene_analysis*.md.
"""
import io
from config import DEBUG
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from PIL import Image
import pillow_heif
from sqlalchemy.orm import Session
from geoalchemy2.elements import WKTElement

from app.core.gemini_service import GeminiQuotaExceededError

from app.core.database import get_db
from app.core.auth import get_current_sketcher_id
from app.core.models import Sketch
from app.features.scene_analysis.schemas import SceneAnalysisResponse
from app.core import rules
from app.features.scene_analysis import service as scene_analysis_service
from app.core.exif_utils import extract_location_and_time
from app.core.paths import UPLOAD_DIR
from app.features.geocode.service import reverse_geocode

pillow_heif.register_heif_opener()

router = APIRouter(prefix="/api", tags=["scene-analysis"])


@router.post("/scene-analysis", response_model=SceneAnalysisResponse)
async def scene_analysis(
    sketch_id: str = Form(...),
    style: str = Form(...),
    # Optional now: both call sites (CreateSketch.jsx right after
    # upload, EditSketch.jsx's "Resume AI-guided questions") are calling
    # this for a sketch whose reference photo is already on disk, so
    # there's no need to have the browser fetch it back from /uploads
    # and re-post it here -- that round trip is redundant work and, for
    # a same-origin-port-mismatched dev setup, a needless cross-origin
    # fetch that CORS can legitimately block. Kept accepting a direct
    # upload for backward compatibility / any future caller that has
    # fresh bytes the server doesn't have yet.
    image: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    try:
        rules.validate_style(style)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")

    # Cache hit: same style, and nothing else the analysis depends on has
    # changed -- framing, focal points or marks (service.plan_fingerprint).
    # The fingerprint is stored with the cached result; a result cached
    # before it existed has none, so it re-runs once.
    fingerprint = scene_analysis_service.plan_fingerprint(sketch)
    cached = sketch.cached_scene_analysis
    if sketch.style == style and cached and cached.get("plan_fingerprint") == fingerprint:
        # Backfill a still-missing title even on a cache hit.
        cached_title = (cached.get("suggested_title") or "").strip()
        if cached_title and not sketch.title:
            sketch.title = cached_title[:150]
            db.commit()
        # Recompute the "There is the ... here" questions against the sketch's
        # current points and marks, dropping areas adopted since.
        return scene_analysis_service.refresh_suggestions(cached, sketch.focal_points, sketch.marks, style)

    if image is not None:
        contents = await image.read()
        try:
            pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
        except Exception:
            raise HTTPException(400, "Could not decode image")
    else:
        if not sketch.reference_image_url:
            raise HTTPException(400, "This sketch has no reference photo on file")
        image_path = UPLOAD_DIR / Path(sketch.reference_image_url).name
        try:
            pil_image = Image.open(image_path).convert("RGB")
        except Exception:
            raise HTTPException(400, "Could not load this sketch's photo")

    location, captured_at = extract_location_and_time(pil_image)
    pil_image = scene_analysis_service.resize_if_needed(pil_image)

    try:
        result, raw_gemini_text = scene_analysis_service.analyze(
            pil_image, style, sketch.crop_transform,
            plan=scene_analysis_service.build_plan(sketch),
        )
    except GeminiQuotaExceededError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    # The browser's debug panel shows it only with DEBUG=true in .env.
    result["debug_raw_gemini_response"] = raw_gemini_text if DEBUG else None
    result["plan_fingerprint"] = fingerprint

    # A sketcher hasn't typed anything yet the first time a sketch reaches
    # this call (title entry is deferred entirely to EditSketch.jsx) --
    # fill it in from Gemini's suggestion so the sketch isn't stuck showing
    # "Untitled sketch" on the home feed while it's mid-flow. Never
    # overwrites a title the sketcher already has, including on a re-
    # analysis triggered by picking a different style.
    suggested_title = (result.get("suggested_title") or "").strip()
    if suggested_title and not sketch.title:
        sketch.title = suggested_title[:150]

    sketch.style = style
    sketch.scene_type = result["scene_type"]
    sketch.cached_scene_analysis = result
    if location:
        # Only resolve/store a label the first time a location is being
        # set for this sketch -- a re-analysis (picking a different style,
        # say) should never clobber a label the sketcher already has,
        # whether that came from this same EXIF reading earlier or from a
        # manual search pick since (LocationSearchField.jsx). Real
        # reverse geocoding via Nominatim (geocode.py), not a Gemini
        # guess from bare coordinates -- see parking-lot.md.
        sketch.location = WKTElement(f"POINT({location['lon']} {location['lat']})", srid=4326)
        if not sketch.location_label:
            label = await reverse_geocode(location["lat"], location["lon"])
            if label:
                sketch.location_label = label[:200]
    if captured_at:
        sketch.captured_at = captured_at
    db.commit()

    return result
