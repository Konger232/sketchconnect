"""
Sketch CRUD that isn't a Gemini call: create the entry at upload time
(design doc, Section 5, step 1) and list/read for the profile feed
("Sketches" / "Feedback Summary" tabs).

Images are written to backend/uploads/ for local dev. Swap this for
Supabase Storage before deploying (design doc doesn't specify a storage
layer, so this is a placeholder, not a documented decision).
"""
import io
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, UploadFile, File, Form, HTTPException
from PIL import Image, ImageOps
import pillow_heif
from sqlalchemy.orm import Session
from geoalchemy2.shape import to_shape
from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_Distance, ST_DWithin

from app.core.database import get_db
from app.core.auth import get_current_sketcher_id, get_optional_sketcher_id
from app.core.models import Sketch, CritiqueResponse, Profile
from app.core.debug import DEBUG_DIR
from app.features.sketches.schemas import (
    AdoptMarkRequest, MarkSelectionRequest, SketchUpdateRequest, SketcherFocalPointInput,
)
from app.core.schemas import FocalRegion, SessionChoice, region_points
from app.core.exif_utils import extract_location_and_time
from app.features.sketches.focal_pairing import pair_focal_points, region_anchor
from app.features.scene_analysis import question_bank
from app.core.value_study import compute_value_study
from app.core.paths import UPLOAD_DIR
from config import MAX_MARKS, MAX_POINTS_PER_MARK
from app.features.critique_agent.router import start_critique
from app.features.geocode.service import reverse_geocode

# Registered again here (also done in scene_analysis.py) so this module
# decodes HEIC/HEIF correctly even if imported before that one — the
# registration is process-global, but this keeps the module correct in
# isolation rather than relying on router import order.
pillow_heif.register_heif_opener()

router = APIRouter(prefix="/api", tags=["sketches"])

UPLOAD_DIR.mkdir(exist_ok=True)


def _sketch_to_dict(s: Sketch, latest_critique: str | None = None) -> dict:
    location = None
    if s.location is not None:
        point = to_shape(s.location)
        location = {"lat": point.y, "lon": point.x, "label": s.location_label}
    return {
        "id": s.id,
        "title": s.title,
        "field_notes": s.field_notes,
        "style": s.style,
        "scene_type": s.scene_type,
        "reference_image_url": s.reference_image_url,
        "final_sketch_url": s.final_sketch_url,
        "location": location,
        "captured_at": s.captured_at,
        "original_image_url": s.original_image_url,
        "crop_transform": s.crop_transform,
        "focal_points": s.focal_points,
        "marks": s.marks or [],
        # Gemini's own suggested focal regions (label + contour), so
        # FocalFrameEditor.jsx can re-offer any of these the sketcher
        # hasn't already adopted when it's reopened from EditSketch.jsx
        # -- previously only surfaced during the original capture flow,
        # never persisted back out to the frontend after the fact.
        "focal_regions": (s.cached_scene_analysis or {}).get("focal_regions", []),
        # Eye level + vanishing points (scene_analysis/schemas.py Perspective),
        # or None. Older cached results only had perspective_lines, which
        # nothing reads any more; they show no overlay until re-analysed.
        "perspective": (s.cached_scene_analysis or {}).get("perspective"),
        # Unit + measured spans for the proportions overlay, or None.
        "proportions": (s.cached_scene_analysis or {}).get("proportions"),
        # Which grid to offer: "grid" (square) or "rule_of_thirds", by style.
        "grid": question_bank.grid_action(s.style),
        "created_at": s.created_at,
        "is_draft": bool(s.is_draft),
        # The latest critique's text, if any -- this is what
        # SketchCard.jsx's feed view shows as the sketch's description,
        # with a Read more/Show less toggle once it runs long. None (not
        # "") when nothing's been critiqued yet, so the frontend can tell
        # "no feedback yet" apart from "feedback text that happens to be
        # empty" via a null check rather than string truthiness.
        "critique": latest_critique,
    }


_MARK_ID = re.compile(r"^m\d{1,5}$")
_MAX_MS = 24 * 60 * 60 * 1000  # a day, in ms: anything longer is not a real stroke time


def _ms(v) -> int | None:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= _MAX_MS else None


def _clean_marks(raw: str) -> list[dict]:
    """
    Validate the client's marks JSON (Marks.jsx) into
    [{id: 'm7', source?: 'own' | 'prompted', color: '#rrggbb', width: float,
    size_mm?: float, points: [[x, y], ...], started_ms?, duration_ms?,
    erased?, erased_ms?, selected?, from_focal_point?}], x/y clamped to the 0-1000 frame, in stroke order.
    Malformed individual marks are dropped rather than failing the whole
    save; a payload that isn't a JSON list is a 400. A missing or repeated
    id gets a new one, so every stored mark has a unique id. Over
    MAX_MARKS, the oldest erased marks go first.
    """
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        raise HTTPException(400, "marks must be JSON")
    if not isinstance(data, list):
        raise HTTPException(400, "marks must be a JSON array")

    data = [m for m in data if isinstance(m, dict)]
    while len(data) > MAX_MARKS:
        erased = next((i for i, m in enumerate(data) if m.get("erased") is True), None)
        if erased is None:
            data = data[:MAX_MARKS]
            break
        del data[erased]

    cleaned = []
    for m in data:
        color = m.get("color")
        width = m.get("width")
        points = m.get("points")
        if not (isinstance(color, str) and len(color) == 7 and color.startswith("#")):
            continue
        if not isinstance(width, (int, float)) or not (0 < width <= 50):
            continue
        if not isinstance(points, list) or not points:
            continue
        pts = []
        for p in points[:MAX_POINTS_PER_MARK]:
            if (
                isinstance(p, (list, tuple)) and len(p) == 2
                and all(isinstance(v, (int, float)) for v in p)
            ):
                pts.append([round(min(1000, max(0, p[0])), 1), round(min(1000, max(0, p[1])), 1)])
        if not pts:
            continue
        mark = {"id": m.get("id"), "color": color.lower(), "width": float(width), "points": pts}
        # The line size the sketcher picked (Marks.jsx, 0.5 / 1 / 2 mm).
        # Older marks have none.
        size_mm = m.get("size_mm")
        if isinstance(size_mm, (int, float)) and 0 < size_mm <= 10:
            mark["size_mm"] = float(size_mm)
        for key in ("started_ms", "duration_ms", "erased_ms"):
            v = _ms(m.get(key))
            if v is not None:
                mark[key] = v
        for key in ("erased", "selected"):
            if m.get(key) is True:
                mark[key] = True
        # "prompted": added from an AI suggestion ("Yes, add it"). Evidence,
        # item 15. Missing means the sketcher's own mark.
        if m.get("source") in ("own", "prompted"):
            mark["source"] = m["source"]
        # The focal area a prompted mark was adopted from (item 17).
        if isinstance(m.get("adopted_region"), int) and not isinstance(m.get("adopted_region"), bool):
            mark["adopted_region"] = m["adopted_region"]
        # A focal point this mark was converted from (item 17), kept whole.
        if isinstance(m.get("from_focal_point"), dict):
            mark["from_focal_point"] = m["from_focal_point"]
        if mark.get("erased"):
            mark.pop("selected", None)  # an erased mark can't be the focus
        else:
            mark.pop("erased_ms", None)
        cleaned.append(mark)

    # Every mark gets a unique id; bad or repeated ones get the next free number.
    used = {c["id"] for c in cleaned if isinstance(c["id"], str) and _MARK_ID.match(c["id"])}
    next_n = max((int(i[1:]) for i in used), default=0) + 1
    seen = set()
    for c in cleaned:
        if not (isinstance(c["id"], str) and _MARK_ID.match(c["id"])) or c["id"] in seen:
            c["id"] = f"m{next_n}"
            next_n += 1
        seen.add(c["id"])
    return cleaned


def _latest_critiques_by_sketch(db: Session, sketch_ids: list[str]) -> dict[str, str]:
    """
    One query for the latest critique text per sketch, instead of an N+1
    loop. CritiqueResponse has no ORM relationship back to Sketch (see
    models.py -- just a bare sketch_id FK column), so "the latest critique
    for each of these sketches" has to be assembled by hand, the same way
    get_sketch already does for a single sketch's full critiques list.
    """
    if not sketch_ids:
        return {}
    rows = (
        db.query(CritiqueResponse)
        .filter(CritiqueResponse.sketch_id.in_(sketch_ids))
        .order_by(CritiqueResponse.created_at.asc())
        .all()
    )
    latest: dict[str, str] = {}
    for c in rows:
        latest[c.sketch_id] = c.critique  # ascending order -> last write wins = latest
    return latest


@router.post("/sketches")
async def create_sketch(
    title: str | None = Form(None),
    field_notes: str | None = Form(None),
    crop_transform: str | None = Form(None),
    image: UploadFile = File(...),
    framed_image: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    Creates the sketch row immediately at upload — before style is even
    chosen. The uploaded photo (HEIC from an iPhone, PNG, whatever) is
    always decoded and re-saved as a JPEG, regardless of what format it
    came in as. Reference photos get displayed directly as <img src=...>
    on the sketch-flow and detail pages, and most browsers (everything but
    Safari) can't render HEIC there — storing the raw bytes under their
    original extension left those pages permanently broken for any
    HEIC-sourced sketch. exif_transpose corrects for phone photos whose
    orientation is stored as EXIF metadata rather than baked into the
    pixels, which a naive re-encode would otherwise flatten into a
    sideways image.
    """
    contents = await image.read()
    try:
        pil_image = Image.open(io.BytesIO(contents))
        # Extracted from the freshly opened image, before exif_transpose or
        # convert() touch it — same source scene_analysis.py's own EXIF
        # extraction relies on, kept in this order defensively.
        location, captured_at = extract_location_and_time(pil_image)
        pil_image = ImageOps.exif_transpose(pil_image)
        pil_image = pil_image.convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not decode image")

    original_filename = f"{uuid.uuid4()}.jpg"
    pil_image.save(UPLOAD_DIR / original_filename, format="JPEG", quality=90)
    original_image_url = f"/uploads/{original_filename}"

    # The common case: nothing was cropped, so reference_image_url just
    # reuses the same file as original_image_url -- no duplicate storage
    # unless the sketcher actually touched CropFrame.jsx and the frontend
    # sent a baked framed_image.
    reference_image_url = original_image_url
    if framed_image is not None:
        framed_contents = await framed_image.read()
        try:
            framed_pil = Image.open(io.BytesIO(framed_contents)).convert("RGB")
        except Exception:
            raise HTTPException(400, "Could not decode framed image")
        framed_filename = f"{uuid.uuid4()}.jpg"
        framed_pil.save(UPLOAD_DIR / framed_filename, format="JPEG", quality=90)
        reference_image_url = f"/uploads/{framed_filename}"

    sketch = Sketch(
        sketcher_id=sketcher_id,
        is_draft=True,  # until Start Sketching (confirm_sketch)
        title=title,
        field_notes=field_notes,
        reference_image_url=reference_image_url,
        original_image_url=original_image_url,
        captured_at=captured_at,
    )
    if location:
        sketch.location = WKTElement(f"POINT({location['lon']} {location['lat']})", srid=4326)
        label = await reverse_geocode(location["lat"], location["lon"])
        if label:
            sketch.location_label = label[:200]
    if crop_transform:
        try:
            sketch.crop_transform = json.loads(crop_transform)
        except (TypeError, ValueError):
            pass  # malformed client payload -- don't fail the upload over metadata
    db.add(sketch)
    _delete_stale_drafts(db, sketcher_id)
    db.commit()
    db.refresh(sketch)
    return _sketch_to_dict(sketch)


# A draft (New Sketch never reached Start Sketching) older than this is
# treated as abandoned: deleted the next time the same sketcher starts one.
DRAFT_TTL = timedelta(days=1)


def _delete_stale_drafts(db: Session, sketcher_id: str) -> None:
    """Delete this sketcher's abandoned drafts, files and all. Caller commits."""
    cutoff = datetime.utcnow() - DRAFT_TTL
    for old in db.query(Sketch).filter(
        Sketch.sketcher_id == sketcher_id, Sketch.is_draft.is_(True), Sketch.created_at < cutoff
    ).all():
        _delete_sketch_files(old)
        db.delete(old)


@router.post("/sketches/{sketch_id}/confirm")
async def confirm_sketch(
    sketch_id: str,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    Start Sketching: the end of New Sketch. The sketch stops being a draft,
    shows in the feeds, and its guided answers are final.
    """
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")
    sketch.is_draft = False
    db.commit()
    return {"is_draft": False}


@router.put("/sketches/{sketch_id}")
async def update_sketch(
    sketch_id: str,
    body: SketchUpdateRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    Editing a saved sketch: title, field_notes, and location are all
    optional and independently updatable — only fields present in the
    request body get changed (design doc doesn't specify a partial-update
    convention, so this mirrors profile.py's update_profile: None means
    "leave as-is", not "clear this field") -- EXCEPT `location`, which is
    the one field with a real "clear it" affordance in the UI
    (LocationSearchField.jsx's X button): sending `location: null`
    explicitly clears both the coordinates and their label, distinguished
    from simply omitting `location` (leave as-is) via `model_fields_set`,
    since Optional[...] = None can't tell those two apart on its own.
    """
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")

    if body.title is not None:
        sketch.title = body.title
    if body.field_notes is not None:
        sketch.field_notes = body.field_notes
    if "location" in body.model_fields_set:
        if body.location is None:
            sketch.location = None
            sketch.location_label = None
        else:
            sketch.location = WKTElement(
                f"POINT({body.location.lon} {body.location.lat})", srid=4326
            )
            sketch.location_label = body.location.label
    if body.style is not None:
        sketch.style = body.style
    if body.captured_at is not None:
        sketch.captured_at = body.captured_at

    db.commit()
    db.refresh(sketch)
    return _sketch_to_dict(sketch)


@router.post("/sketches/{sketch_id}/focal-frame")
async def save_focal_frame(
    sketch_id: str,
    old_points: str = Form(...),
    new_points: str = Form(...),
    crop_transform: str | None = Form(None),
    framed_image: UploadFile | None = File(None),
    marks: str | None = Form(None),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    Persists the result of FocalFrameEditor.jsx's mark-then-frame-refine
    flow (frontend: FocalFrameEditor.jsx, geometry: lib/focalGeometry.js;
    backend geometry: features/sketches/focal_pairing.py -- see that file's own
    docstring for why pairing is plain geometry here rather than another
    Gemini call).

    `old_points` and `new_points` are parallel arrays, same length and
    order, one entry per confirmed focal point (the sketcher's own marks
    plus anything they adopted from a Gemini suggestion):
      - old_points: [{x, y, source, region_ref}], normalized against
        whatever frame was actually analyzed -- i.e. the same coordinate
        space `sketch.cached_scene_analysis["focal_regions"]` is already
        in. This is what pair_focal_points() needs to resolve each point
        to a region label; it's the frame the sketcher was looking at
        while marking, not necessarily the frame they end up confirming.
      - new_points: [{x, y}], the same points reprojected (client-side,
        via focalGeometry.js's toOriginalSpace/toFrameSpace round trip
        through the original photo's own coordinate space) into whatever
        frame the sketcher settled on after the pan/zoom refine step --
        i.e. the frame `framed_image` below actually shows. These are the
        positions that get stored, so a reticle drawn at a stored point
        later lines up with the photo it's stored next to.

    `framed_image` + `crop_transform` are only sent when the sketcher
    actually changed the framing during the refine step (mirrors
    create_sketch's own optional `framed_image` -- "no change" is the
    common case and shouldn't cost a re-encode or a re-upload). When
    present: the new photo replaces reference_image_url (the old one is
    deleted unless it's also original_image_url), crop_transform is
    updated, and -- since focal_regions/perspective were computed
    against the frame that just changed -- cached_scene_analysis is
    cleared so SketchFlowPage's next load re-runs Gemini against the new
    framing rather than serving a now-mismatched cached result (the same
    invalidation rule scene_analysis.py already applies for a style
    change, extended to cover a framing change too).
    """
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")

    try:
        old_points_raw = json.loads(old_points)
        new_points_raw = json.loads(new_points)
    except (TypeError, ValueError):
        raise HTTPException(400, "old_points/new_points must be JSON")

    if not isinstance(old_points_raw, list) or not isinstance(new_points_raw, list):
        raise HTTPException(400, "old_points/new_points must be JSON arrays")
    if len(old_points_raw) != len(new_points_raw):
        raise HTTPException(400, "old_points and new_points must be the same length")

    try:
        parsed_points = [SketcherFocalPointInput(**p) for p in old_points_raw]
    except Exception as exc:
        raise HTTPException(400, f"Invalid old_points: {exc}")

    cached = sketch.cached_scene_analysis or {}
    try:
        regions = [FocalRegion(**r) for r in cached.get("focal_regions", [])]
    except Exception:
        # A malformed cached region shouldn't block saving the sketcher's
        # marks -- fall back to "nothing to pair against", same spirit as
        # focal_pairing.py's own per-region defensiveness.
        regions = []

    paired = pair_focal_points(parsed_points, regions)

    focal_points = []
    for paired_point, new_xy in zip(paired, new_points_raw):
        record = paired_point.model_dump()
        record["x"] = new_xy.get("x")
        record["y"] = new_xy.get("y")
        focal_points.append(record)
    sketch.focal_points = focal_points

    # Planning marks (Marks.jsx), drawn on the same frame as the
    # points above. Omitted -> leave as-is, unless the frame itself changed
    # below, in which case old marks no longer line up and are dropped.
    if marks is not None:
        sketch.marks = _clean_marks(marks)
    elif framed_image is not None:
        sketch.marks = None

    if framed_image is not None:
        framed_contents = await framed_image.read()
        try:
            framed_pil = Image.open(io.BytesIO(framed_contents)).convert("RGB")
        except Exception:
            raise HTTPException(400, "Could not decode framed image")
        framed_filename = f"{uuid.uuid4()}.jpg"
        framed_pil.save(UPLOAD_DIR / framed_filename, format="JPEG", quality=90)
        new_reference_url = f"/uploads/{framed_filename}"

        old_reference_url = sketch.reference_image_url
        if old_reference_url and old_reference_url != sketch.original_image_url:
            _delete_upload_file(old_reference_url)

        sketch.reference_image_url = new_reference_url
        if crop_transform:
            try:
                sketch.crop_transform = json.loads(crop_transform)
            except (TypeError, ValueError):
                pass
        # The frame this focal_points set was reprojected onto no longer
        # matches whatever Gemini last analyzed -- see docstring above.
        sketch.cached_scene_analysis = None
        sketch.scene_type = None

    db.commit()
    db.refresh(sketch)
    return _sketch_to_dict(sketch)


# Guided-question keys asked more than once per sketch (one per selected
# shape, or per missed focal area). Matched with AIGuidance.jsx.
REPEATED_KEYS = {"mark_meaning", "focal_suggestion"}


@router.post("/sketches/{sketch_id}/session-choices")
async def add_session_choice(
    sketch_id: str,
    body: SessionChoice,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    Save one guided-question answer. Read later by the critique call. One
    answer per question: a new answer to the same key (or, for answers
    without a key, the same question text) replaces the earlier one, so
    the critique only sees the sketcher's latest choice.
    """
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")
    if not sketch.is_draft:
        raise HTTPException(409, "Guided answers can't change once the sketch is created")
    choice = {**body.model_dump(exclude_none=True), "answered_at": datetime.now(timezone.utc).isoformat()}

    def same_question(old: dict) -> bool:
        # These keys are asked once per shape or area, so the question text
        # tells them apart.
        if choice.get("key") and choice["key"] not in REPEATED_KEYS:
            return old.get("key") == choice["key"]
        return old.get("key") == choice.get("key") and old.get("prompt") == choice["prompt"]

    # Assign a new list. SQLAlchemy doesn't detect in-place edits to a JSON column.
    sketch.session_choices = [c for c in (sketch.session_choices or []) if not same_question(c)] + [choice]
    db.commit()
    return {"count": len(sketch.session_choices)}


@router.put("/sketches/{sketch_id}/marks/selection")
async def set_mark_selection(
    sketch_id: str,
    body: MarkSelectionRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    Sets which marks are selected, from Edit's Plan photo (GuideStage's
    Select marks tool). The selection is part of the plan, so it is part
    of the scene analysis fingerprint: the next guidance run re-analyses.
    Returns the saved marks.
    """
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")

    wanted = set(body.selected_ids)
    marks = []
    for i, m in enumerate(sketch.marks or []):
        m = dict(m)
        # Marks saved before ids existed: the same m1, m2, ... fallback as
        # mark_geometry.mark_id, now stored.
        m.setdefault("id", f"m{i + 1}")
        if m.get("id") in wanted and not m.get("erased"):
            m["selected"] = True
        else:
            m.pop("selected", None)
        marks.append(m)
    # A new list, so SQLAlchemy sees the JSON column change.
    sketch.marks = marks
    db.commit()
    return {"marks": marks}


@router.post("/sketches/{sketch_id}/marks/adopt")
async def adopt_focal_area(
    sketch_id: str,
    body: AdoptMarkRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    "Yes, add it" to "There is the ... here" during AI guidance (design
    doc, items 13 and 17). The missed focal area becomes a mark along its
    traced outline, closed, with source "prompted" and adopted_region set
    to region_ref. It looks like any other mark; the critique reads it as
    prompted evidence (item 15). Adopting the same area twice is a no-op.
    Prompted marks are left out of the scene analysis fingerprint, so this
    keeps the cached analysis. Returns the saved marks.
    """
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")

    cached = sketch.cached_scene_analysis or {}
    regions = cached.get("focal_regions") or []
    if not 0 <= body.region_ref < len(regions):
        raise HTTPException(400, "No such focal area in this sketch's analysis")

    marks = [dict(m) for m in (sketch.marks or [])]
    if any(m.get("adopted_region") == body.region_ref and not m.get("erased") for m in marks):
        return {"marks": marks}

    pts = [[round(min(1000, max(0, x)), 1), round(min(1000, max(0, y)), 1)]
           for x, y in region_points(regions[body.region_ref])]
    if len(pts) < 3:
        raise HTTPException(400, "This focal area's outline is unreadable")
    pts.append(list(pts[0]))  # close the outline

    color = body.color.lower() if re.fullmatch(r"#[0-9a-fA-F]{6}", body.color or "") else "#fde68a"
    for k, m in enumerate(marks):  # marks saved before ids existed
        m.setdefault("id", f"m{k + 1}")
    used = [int(m["id"][1:]) for m in marks if re.fullmatch(r"m\d+", str(m["id"]))]
    mark = {
        "id": f"m{max(used, default=0) + 1}",
        "source": "prompted",
        "color": color,
        "width": float(body.width),
        "points": pts,
        "adopted_region": body.region_ref,
    }
    if body.size_mm:
        mark["size_mm"] = float(body.size_mm)
    marks.append(mark)
    # A new list, so SQLAlchemy sees the JSON column change.
    sketch.marks = marks
    db.commit()
    return {"marks": marks}


@router.post("/sketches/{sketch_id}/final-sketch")
async def upload_final_sketch(
    sketch_id: str,
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    Save the sketcher's final sketch, then start the critique call in the
    background. Returns right away with critique_status 'pending'.
    A newer upload replaces the old file and runs the critique again.
    """
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")
    if sketch.critique_status == "pending":
        raise HTTPException(409, "Feedback is still being prepared for the last upload")

    contents = await image.read()
    try:
        pil_image = ImageOps.exif_transpose(Image.open(io.BytesIO(contents))).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not decode final sketch image")

    filename = f"{uuid.uuid4()}.jpg"
    pil_image.save(UPLOAD_DIR / filename, format="JPEG", quality=90)
    _delete_upload_file(sketch.final_sketch_url)
    sketch.final_sketch_url = f"/uploads/{filename}"
    sketch.final_sketch_provided = True

    start_critique(db, sketch, background_tasks)  # commits
    db.refresh(sketch)
    data = _sketch_to_dict(sketch)
    data["critique_status"] = sketch.critique_status
    return data


@router.get("/sketches/{sketch_id}/value-study")
async def sketch_value_study(
    sketch_id: str,
    levels: int = 4,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    On-demand "dominant value shapes" toggle for SketchDetailPage's
    edit-mode view (see core/value_study.py's docstring for the
    algorithm -- deterministic OpenCV, not a Gemini call). Scoped to the
    sketch's owner, same as update_sketch/delete_sketch: this is a
    working aid for the sketcher's own in-progress sketch, not a public
    sketch-detail field.

    Computed fresh on every call rather than cached alongside
    cached_scene_analysis: it's a single deterministic pass over an
    already-downscaled photo (cheap), and a sketcher may want to try a
    few different `levels` values, which a cached single result
    couldn't serve anyway.
    """
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")

    image_path = UPLOAD_DIR / Path(sketch.reference_image_url).name
    try:
        pil_image = Image.open(image_path)
    except Exception:
        raise HTTPException(400, "Could not load this sketch's photo")

    return compute_value_study(pil_image, levels)


def _delete_sketch_files(sketch: Sketch) -> None:
    """A sketch's images in uploads/, and its dev-only mark dumps (core/debug.py)."""
    for url in {sketch.original_image_url, sketch.reference_image_url, sketch.final_sketch_url}:
        _delete_upload_file(url)
    for path in DEBUG_DIR.glob(f"marks_{sketch.id}_*.json") if DEBUG_DIR.exists() else []:
        path.unlink(missing_ok=True)


def _delete_upload_file(url: str | None) -> None:
    """
    Best-effort delete of one uploaded file, given its stored URL
    (e.g. "/uploads/<uuid>.jpg"). Path(url).name strips any directory
    component down to the bare filename before joining it back onto
    UPLOAD_DIR, so this can't be tricked into deleting anything outside
    that folder. missing_ok=True since a sketch's original and reference
    image can point at the same file (the common, uncropped case -- see
    create_sketch) -- delete_sketch below calls this once per distinct
    URL, but a file already gone is not an error either way.
    """
    if not url:
        return
    (UPLOAD_DIR / Path(url).name).unlink(missing_ok=True)


@router.delete("/sketches/{sketch_id}")
async def delete_sketch(
    sketch_id: str,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    Permanently removes a sketch: its image file(s) on disk, then the
    Sketch row itself. help_quest_log and critique_responses rows for
    this sketch are cleaned up by Postgres automatically -- schema.sql
    has ON DELETE CASCADE on both tables' sketch_id foreign keys, so
    there's nothing to do for those here.

    This is the sketcher's one way to remove a sketch, at any point in
    its life -- right after Step 1's upload with nothing else done yet,
    or fully completed with feedback attached (see parking-lot.md: an
    earlier plan split this into two mechanisms, an in-flow Discard
    button plus a separate delete, before settling on this single one).
    """
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")

    _delete_sketch_files(sketch)
    db.delete(sketch)
    db.commit()
    return {"deleted": True}


@router.get("/sketches")
async def list_sketches(
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """Feed for the profile 'Sketches' tab, newest first."""
    rows = (
        db.query(Sketch)
        .filter(Sketch.sketcher_id == sketcher_id, Sketch.is_draft.is_(False))
        .order_by(Sketch.created_at.desc())
        .all()
    )
    latest = _latest_critiques_by_sketch(db, [s.id for s in rows])
    return [_sketch_to_dict(s, latest.get(s.id)) for s in rows]


@router.get("/sketches/recent")
async def list_recent_sketches(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_km: float = 50.0,
    limit: int = 10,
    db: Session = Depends(get_db),
):
    """
    Public feed for the logged-out Home page: recent sketches, ordered by
    distance when the visitor's GPS coordinates are given, across ALL
    sketchers — the only endpoint in this file that intentionally isn't
    scoped to one sketcher. Falls back to most-recent-overall when no
    coordinates are given, or when nothing falls within radius_km, so the
    page is never empty just because no one's sketched nearby yet.

    Registered ABOVE /sketches/{sketch_id} on purpose — FastAPI matches
    routes in file order, and "recent" would otherwise be swallowed as a
    (nonexistent) sketch_id.
    """
    # AI critique/feedback text is never included here, for anyone --
    # this feed is public by design (Home page, logged in or not), and
    # critique is the one thing that stays sketcher-only no matter what.
    # See get_sketch below for the same rule on the detail page.
    if lat is not None and lon is not None:
        point = WKTElement(f"POINT({lon} {lat})", srid=4326)
        nearby = (
            db.query(Sketch)
            .filter(Sketch.is_draft.is_(False))
            .filter(Sketch.location.isnot(None))
            .filter(ST_DWithin(Sketch.location, point, radius_km * 1000))
            .order_by(ST_Distance(Sketch.location, point))
            .limit(limit)
            .all()
        )
        if nearby:
            return [_sketch_to_dict(s) for s in nearby]

    rows = db.query(Sketch).filter(Sketch.is_draft.is_(False)).order_by(Sketch.created_at.desc()).limit(limit).all()
    return [_sketch_to_dict(s) for s in rows]


@router.get("/sketches/{sketch_id}")
async def get_sketch(
    sketch_id: str,
    db: Session = Depends(get_db),
    sketcher_id: str | None = Depends(get_optional_sketcher_id),
):
    """
    Detail view backing both the owner's 'Feedback Summary' tab AND the
    public read-only sketch page anyone can click through to from the
    Home feeds (design decision: sketches are public by default, no
    per-sketch privacy toggle -- "keep it simple"). Photos, title, field
    notes, and location are shown to anyone; AI critique/feedback text
    (and the raw decision_trace behind it) is the one thing that's never
    shared -- `critiques` is only populated, and the sketch's own
    `critique` field only filled in, when the requester is verified as
    this sketch's owner. is_owner tells the frontend whether to render
    the owner-only Edit/Delete/feedback UI at all.
    """
    sketch = db.query(Sketch).filter(Sketch.id == sketch_id).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")

    is_owner = sketcher_id is not None and sketcher_id == sketch.sketcher_id
    # A draft is the owner's alone until Start Sketching.
    if sketch.is_draft and not is_owner:
        raise HTTPException(404, "Sketch not found")

    # The sketch owner's public name and avatar, shown at the top of the
    # sketch's right panel. Public, like the profile itself.
    owner_profile = db.query(Profile).filter(Profile.id == sketch.sketcher_id).first()
    owner = {
        "display_name": owner_profile.display_name if owner_profile else None,
        "avatar_url": owner_profile.avatar_url if owner_profile else None,
    }

    if not is_owner:
        data = _sketch_to_dict(sketch)
        data["owner"] = owner
        data["is_owner"] = False
        return data

    critiques = (
        db.query(CritiqueResponse)
        .filter(CritiqueResponse.sketch_id == sketch_id)
        .order_by(CritiqueResponse.created_at.asc())
        .all()
    )
    data = _sketch_to_dict(sketch, critiques[-1].critique if critiques else None)
    data["critiques"] = [
        {
            "critique": c.critique,
            "decision_trace": c.decision_trace,
            "final_sketch_provided": c.final_sketch_provided,
            "created_at": c.created_at,
        }
        for c in critiques
    ]
    data["owner"] = owner
    data["critique_status"] = sketch.critique_status
    # The sketcher's guided answers, so the Guide tab can show their picks.
    data["session_choices"] = sketch.session_choices or []
    data["is_owner"] = True
    return data
