"""
POST /api/marks-analysis: the marks analysis call, the plan read (design
doc, Section 11, items 20 and 25). Fires when the sketcher finishes the
strokes and the media card in New Sketch, and again when the strokes, the
selection or the media change. Edit Sketch reads it from the cache.

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

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import HTMLResponse
from PIL import Image
import pillow_heif
from sqlalchemy.orm import Session

from config import COACHING_MAX_DIMENSION, DEBUG
from app.features.marks_analysis import debug_report, plan_read
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


def _save_media(db: Session, sketch: Sketch, picks: list[str]) -> None:
    """The media card's picks (design doc, item 25), kept with the answers
    as one entry with key "media", so the critique and the next sketch's
    card can read them. Part of the cache fingerprint: the tips follow them."""
    picks = plan_read.clean_media(picks)
    if picks == service.media_of(sketch) and any(c.get("key") == "media" for c in sketch.session_choices or []):
        return
    entry = {"key": "media", "prompt": "What do you draw with?",
             "response": ", ".join(plan_read.MEDIA_NAMES[k] for k in picks) or "Not set",
             "media": picks, "answered_at": datetime.now(timezone.utc).isoformat()}
    # A new list, so SQLAlchemy sees the JSON column change.
    sketch.session_choices = [c for c in sketch.session_choices or [] if c.get("key") != "media"] + [entry]
    db.commit()

CACHE_KEY = "marks_analysis"


@router.post("/marks-analysis", response_model=MarksAnalysisResponse)
async def marks_analysis(
    sketch_id: str = Form(...),
    # The media card's picks, comma-separated keys (plan_read.MEDIA). Sent
    # by New Sketch; omitted elsewhere, which keeps the saved picks.
    media: str | None = Form(None),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    sketch = db.query(Sketch).filter(Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")
    scene = cached_scene(sketch)
    if scene is None:
        raise HTTPException(409, "Run the scene analysis first")
    if media is not None:
        _save_media(db, sketch, [m.strip() for m in media.split(",") if m.strip()])

    # Cache hit: no plan image, no photo load.
    fingerprint = service.fingerprint(sketch, scene)
    cached = scene.get(CACHE_KEY) or {}
    if cached.get("fingerprint") == fingerprint and "cleaned" in cached:
        result = service.assemble(cached["cleaned"], sketch, scene, service.selected_mark_ids(sketch))
        result["debug_report"] = DEBUG and debug_report.report_path(sketch.id).exists()
        return result

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
    if DEBUG and raw_text is not None:
        # One HTML page per call: images, strokes in order, the prompt,
        # Gemini's answer and the guide it became (debug_report.py).
        try:
            prompt = service.build_prompt(plan, scene, sketch)
            # The photo as uploaded. Without a reframe there is no separate
            # original: the reference photo is it.
            original = None
            try:
                src = sketch.original_image_url or sketch.reference_image_url
                original = Image.open(UPLOAD_DIR / Path(src).name).convert("RGB")
                original.thumbnail((1200, 1200))
            except Exception:
                original = None  # missing file: the report says "(none)"
            path = debug_report.write_report(sketch, photo, plan, prompt, raw_text, cleaned, result,
                                             service.ANALYSIS_VERSION, original)
            print(f"[marks_analysis] report: {path}")
            result["debug_report"] = True
        except Exception as exc:  # a report must never break the guide
            print(f"[marks_analysis] report failed: {exc}")
    return result


@router.get("/sketches/{sketch_id}/marks-report", response_class=HTMLResponse)
async def marks_report(
    sketch_id: str,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """DEBUG=true only: the last marks analysis report for this sketch
    (debug_report.py), for the link under the guide question. The owner
    only. 404 when DEBUG is off or no call has written one yet."""
    if not DEBUG:
        raise HTTPException(404, "Not found")
    sketch = db.query(Sketch).filter(Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id).first()
    path = debug_report.report_path(sketch_id)
    if sketch is None or not path.exists():
        raise HTTPException(404, "No marks analysis report for this sketch yet")
    return HTMLResponse(path.read_text(encoding="utf-8"))
