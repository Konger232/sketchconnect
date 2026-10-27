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

from pydantic import BaseModel

from fastapi import APIRouter, BackgroundTasks, Depends, UploadFile, File, Form, HTTPException
from PIL import Image, ImageOps
import pillow_heif
from sqlalchemy import and_, cast, func, or_
from sqlalchemy.orm import Session, load_only
from geoalchemy2 import Geometry
from geoalchemy2.shape import to_shape
from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_Distance, ST_DWithin

from app.core.database import get_db
from app.core.auth import get_current_sketcher_id, get_optional_sketcher_id
from app.core.models import Sketch, CritiqueResponse, Persona, Profile, SketchUpload
from app.core.debug import DEBUG_DIR
from app.features.sketches.schemas import (
    AdoptMarkRequest, MarkSelectionRequest, SketchUpdateRequest, SketcherFocalPointInput,
)
from app.core.schemas import FocalRegion, SessionChoice, normalize_source, region_points
from app.core import design_fundamentals, rules
from app.features.marks_analysis import question_bank as marks_bank
from app.features.marks_analysis.service import chosen_principles, intents_from_choices
from app.core.exif_utils import extract_location_and_time
from app.features.sketches.focal_pairing import pair_focal_points, region_anchor
from app.features.scene_analysis import question_bank
from app.core.value_study import compute_value_study
from app.core.paths import UPLOAD_DIR
from config import DEBUG, MAX_MARKS, MAX_POINTS_PER_MARK
from app.features.critique_agent.router import start_critique
from app.features.geocode.service import place_boxes, reverse_geocode
from app.core.visibility import can_see, visible_filter
from app.core.ttlcache import TTLCache
from app.features.events.tags import sync_tags

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
        # Which grid to offer: "grid" (square) or "rule_of_thirds", by style.
        "grid": question_bank.grid_action(s.style),
        "created_at": s.created_at,
        "palettes": s.palettes or {},
        "value_levels": s.value_levels,
        "gamut_mask": s.gamut_mask,
        "visibility": s.visibility or "members",
        "glazed": bool(s.glazed),
        "style_detected": s.style_detected,
        "style_confirmed": s.style_confirmed,
        # The latest critique's text, if any -- this is what
        # SketchCard.jsx's feed view shows as the sketch's description,
        # with a Read more/Show less toggle once it runs long. None (not
        # "") when nothing's been critiqued yet, so the frontend can tell
        # "no feedback yet" apart from "feedback text that happens to be
        # empty" via a null check rather than string truthiness.
        "critique": latest_critique,
    }


# The columns a sketch card needs (SketchCard, SketchListMapView). Lists load
# only these: a full row carries the stored scene analysis, strokes and plan,
# which made the Sketcher page's list ~176 KB and slow over the network.
CARD_COLUMNS = (
    Sketch.id, Sketch.sketcher_id, Sketch.title, Sketch.field_notes, Sketch.style, Sketch.scene_type,
    Sketch.reference_image_url, Sketch.final_sketch_url, Sketch.location, Sketch.location_label,
    Sketch.captured_at, Sketch.created_at, Sketch.visibility, Sketch.glazed,
)


def card_query(db: Session, *extra):
    """A Sketch query that loads only the card columns."""
    return db.query(Sketch, *extra).options(load_only(*CARD_COLUMNS))


def _sketch_card(s: Sketch) -> dict:
    """A sketch for a card: no plan, strokes or analysis."""
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
        "created_at": s.created_at,
        "visibility": s.visibility or "members",
        "glazed": bool(s.glazed),
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
        # item 15. "intended" (was "own") or missing: the sketcher's own
        # mark. Old values load as the new ones (item 20).
        source = normalize_source(m.get("source"))
        if source in ("intended", "prompted"):
            mark["source"] = source
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
    db.commit()
    db.refresh(sketch)
    return _sketch_to_dict(sketch)


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
    if body.visibility is not None:
        sketch.visibility = body.visibility
    if body.glazed is not None:
        sketch.glazed = body.glazed
    if body.style_confirmed is not None:
        sketch.style_confirmed = body.style_confirmed
        if body.style_confirmed and sketch.style_detected:
            sketch.style = sketch.style_detected
    if body.captured_at is not None:
        sketch.captured_at = body.captured_at
    if body.title is not None or body.field_notes is not None:
        sync_tags(db, sketch)  # hashtags join a sketch to an event (item 49)

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
# shape, or per missed focal area). Matched with AIGuidance.jsx. The marks
# analysis bank adds its per-shape keys (principle_intent, the seed
# questions) and unseen.
def _repeated_keys() -> set[str]:
    return {"mark_meaning", "focal_suggestion"} | marks_bank.repeated_keys()


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
    # Answers lock once the final sketch is uploaded: the critique reads
    # them. The plan read rating ("Is this right?") can still change.
    if sketch.final_sketch_url and body.key != "plan_read":
        raise HTTPException(409, "Answers can't change once the final sketch is uploaded")
    choice = {**body.model_dump(exclude_none=True), "answered_at": datetime.now(timezone.utc).isoformat()}
    if choice.get("key") == "plan_read":
        # One rating for the whole plan read ("Is this right?"). No vote
        # clears it.
        kept = [c for c in (sketch.session_choices or []) if c.get("key") != "plan_read"]
        sketch.session_choices = kept + ([choice] if choice.get("vote") else [])
        db.commit()
        return {"count": len(sketch.session_choices)}
    if choice.get("key") == "bookmark":
        # Bookmarks lock once the final sketch is uploaded: the critique
        # judges the sketch against them.
        if sketch.final_sketch_url:
            raise HTTPException(409, "Bookmarks can't change once the final sketch is uploaded")
        # One bookmark per principle and tip name. bookmarked False clears it.
        if choice.get("principle") not in design_fundamentals.principle_keys():
            raise HTTPException(400, "Unknown principle")
        kept = [c for c in (sketch.session_choices or [])
                if not (c.get("key") == "bookmark" and c.get("principle") == choice["principle"]
                        and c.get("response") == choice["response"])]
        sketch.session_choices = kept + ([choice] if choice.get("bookmarked") else [])
        db.commit()
        return {"count": len(sketch.session_choices)}
    repeated = _repeated_keys()

    def same_question(old: dict) -> bool:
        if old.get("key") != choice.get("key"):
            return False
        # Marks analysis: a question about one object or one pair is told
        # apart by its object or pair, since its wording changes with the
        # sketcher's names.
        if choice.get("refs"):
            return sorted(old.get("refs") or []) == sorted(choice["refs"])
        if choice.get("shape_id") and choice.get("key") == "mark_meaning":
            return old.get("shape_id") == choice["shape_id"]
        # Other keys asked once per shape or area: the question text.
        if choice.get("key") and choice["key"] not in repeated:
            return True
        return old.get("prompt") == choice["prompt"]

    # "What do you want these marks to do?" (item 20): known principles
    # only, and at most max_principles across the whole plan, counting the
    # other answers' intents. "Not sure yet" clears the picks.
    if choice.get("key") == "principle_intent":
        if choice.get("undecided_principle"):
            choice["principles"] = []
        known = set(design_fundamentals.principle_keys())
        picked = list(dict.fromkeys(p for p in choice.get("principles") or [] if p in known))
        if len(picked) != len(choice.get("principles") or []):
            raise HTTPException(400, "Unknown principle")
        others = [c for c in (sketch.session_choices or []) if not same_question(c)]
        total = set(chosen_principles(intents_from_choices(others))) | set(picked)
        cap = marks_bank.max_principles()
        if len(total) > cap:
            raise HTTPException(422, f"{cap} is the most for one plan")
        choice["principles"] = picked
        # An answer by tapping strokes or scene objects (option_index -1) or
        # in their own words is the sketcher's own goal: kept with its
        # mark_ids and words, with no principle named.
        own_answer = choice.get("own_words") or choice.get("option_index") == -1
        if not picked and not choice.get("undecided_principle") and not own_answer:
            raise HTTPException(400, "Pick a principle or Not sure yet")

    # A changed answer (Back, then a new pick) can drop a principle. The
    # answers to seed questions it opened no longer apply (item 20).
    kept = [c for c in (sketch.session_choices or []) if not same_question(c)] + [choice]
    # A new relationship pick for a pair drops the principle answer that
    # followed a different relationship type for that pair.
    if choice.get("key") == "relationship" and choice.get("refs"):
        new_type = (choice.get("relationship") or {}).get("type")
        kept = [
            c for c in kept
            if not (c.get("key") == "principle_intent" and sorted(c.get("refs") or []) == sorted(choice["refs"])
                    and c.get("relationship_type") != new_type)
        ]
    intents = intents_from_choices(kept)

    def still_asked(c: dict) -> bool:
        p = c.get("requires_principle")
        return not p or any(i["principle"] == p and set(i["mark_ids"]) & set(c.get("mark_ids") or []) for i in intents)

    # Assign a new list. SQLAlchemy doesn't detect in-place edits to a JSON column.
    sketch.session_choices = [c for c in kept if still_asked(c)]
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


def _with_options(sketch) -> list[dict]:
    """
    The saved answers, each with the options its question offered, so Edit
    Sketch can show every option with the pick highlighted. Answers saved
    since October 2, 2026 carry their own options. Older ones get them from
    the cached analysis, matched by question text: the marks analysis
    questions, else the scene analysis ones. An answer with no match keeps
    only its pick. Read only: nothing is written back.
    """
    choices = [dict(c) for c in (sketch.session_choices or [])]
    if all(c.get("options") for c in choices):
        return choices
    scene = sketch.cached_scene_analysis or {}
    asked = list(scene.get("prepared_prompts") or [])
    cleaned = (scene.get("marks_analysis") or {}).get("cleaned")
    if cleaned:
        try:
            from app.features.marks_analysis.service import assemble
            asked = assemble(cleaned, sketch, scene, set())["prepared_prompts"] + asked
        except Exception as exc:  # an old or malformed cache: show the picks only
            print(f"[sketches] could not rebuild the guide questions: {exc}")
    by_text = {}
    for position, p in enumerate(asked):
        by_text.setdefault(p.get("question"), (position, p))
    for c in choices:
        if c.get("options") or c.get("prompt") not in by_text:
            continue
        position, p = by_text[c["prompt"]]
        c["options"] = p.get("options") or []
        c["option_hints"] = p.get("option_hints") or []
        c["option_actions"] = p.get("option_actions") or []
        c.setdefault("position", position)
    return choices


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
    # The plan card can add an area until the final sketch is uploaded.
    if sketch.final_sketch_url:
        raise HTTPException(409, "The plan can't change once the final sketch is uploaded")

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


@router.delete("/sketches/{sketch_id}/marks/adopt/{region_ref}")
async def unadopt_focal_area(
    sketch_id: str,
    region_ref: int,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    Undo "Yes, add it": the sketcher went Back and changed the answer to
    "Already in my plan" or "No thanks" (design doc, item 20). The mark
    added from that focal area is removed outright, not erased: it was
    never the sketcher's own stroke, so it is not a revision. Allowed until
    the final sketch is uploaded, like adding one (item 25). Removing a
    mark that is not there is a no-op. Returns the saved marks.
    """
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")
    if sketch.final_sketch_url:
        raise HTTPException(409, "The plan can't change once the final sketch is uploaded")
    marks = [
        dict(m) for m in (sketch.marks or [])
        if not (m.get("adopted_region") == region_ref and m.get("source") == "prompted")
    ]
    if len(marks) != len(sketch.marks or []):
        sketch.marks = marks  # a new list, so SQLAlchemy sees the change
        db.commit()
    return {"marks": marks}


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


@router.post("/sketches/{sketch_id}/final-sketch")
async def upload_final_sketch(
    sketch_id: str,
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    persona_id: Optional[str] = Form(None),
    style: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    Older route, kept for any caller still using it: the same as
    POST /sketches/{id}/uploads with final=true (design doc, item 38).
    """
    if style:
        try:
            rules.validate_style(style)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
    data = await add_upload(sketch_id, background_tasks, image, True, persona_id, db, sketcher_id)
    if style:
        sketch = db.query(Sketch).filter(Sketch.id == sketch_id).first()
        sketch.style = style
        db.commit()
    return data


@router.get("/sketches/{sketch_id}/value-study")
async def sketch_value_study(
    sketch_id: str,
    levels: int = 4,
    scale: bool = False,
    db: Session = Depends(get_db),
    sketcher_id: str | None = Depends(get_optional_sketcher_id),
):
    """
    scale=true: equal steps of lightness, black to white, for the Value
    tab's value distribution (design doc, item 37). Otherwise percentile
    groups of equal area, as before.

    On-demand "dominant value shapes" toggle for SketchDetailPage's
    edit-mode view (see core/value_study.py's docstring for the
    algorithm -- deterministic OpenCV, not a Gemini call). Readable by the
    owner, and by anyone once the sketch is shared, since SketchDetail
    shows the value study the sketcher chose on the Value tab.

    Computed fresh on every call rather than cached alongside
    cached_scene_analysis: it's a single deterministic pass over an
    already-downscaled photo (cheap), and a sketcher may want to try a
    few different `levels` values, which a cached single result
    couldn't serve anyway.
    """
    # The owner, always; anyone else once the sketch is shared, for the
    # value study on SketchDetail.
    sketch = db.query(Sketch).filter(Sketch.id == sketch_id).first()
    if sketch is None or not can_see(db, sketch, sketcher_id):
        raise HTTPException(404, "Sketch not found")

    image_path = UPLOAD_DIR / Path(sketch.reference_image_url).name
    try:
        pil_image = Image.open(image_path)
    except Exception:
        raise HTTPException(400, "Could not load this sketch's photo")

    return compute_value_study(pil_image, levels, scale=scale)


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
    for u in db.query(SketchUpload).filter(SketchUpload.sketch_id == sketch.id).all():
        _delete_upload_file(u.url)
    db.delete(sketch)
    db.commit()
    return {"deleted": True}


def _with_likes(db: Session, rows: list, viewer_id: str | None, dicts: list[dict]) -> list[dict]:
    """Adds like_count, liked and is_owner to each card, for SketchCard's
    heart."""
    from app.features.community.router import like_summary
    likes = like_summary(db, [s.id for s in rows], viewer_id)
    for s, d in zip(rows, dicts):
        d["like_count"], d["liked"] = likes.get(s.id, (0, False))
        d["is_owner"] = bool(viewer_id) and s.sketcher_id == viewer_id
    return dicts


@router.get("/sketches")
async def list_sketches(
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """The sketcher's own sketches, newest first, shared or not. A sketch
    left in New Sketch without Discard stays here as "Sketching", for the
    sketcher to open or delete (design doc, item 30)."""
    rows = (
        db.query(Sketch)
        .filter(Sketch.sketcher_id == sketcher_id)
        .order_by(Sketch.created_at.desc())
        .all()
    )
    latest = _latest_critiques_by_sketch(db, [s.id for s in rows])
    counts = upload_counts(db, [s.id for s in rows])
    dicts = [_sketch_to_dict(s, latest.get(s.id)) | {"upload_count": counts.get(s.id, 0)} for s in rows]
    return _with_likes(db, rows, sketcher_id, dicts)


@router.get("/sketches/recent")
def list_recent_sketches(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_km: float = 50.0,
    limit: int = 10,  # at most 60
    db: Session = Depends(get_db),
    viewer_id: str | None = Depends(get_optional_sketcher_id),
):
    """
    The Home feed (visitor and registered): shared sketches near the
    viewer first, nearest first, then the latest from everywhere else to
    fill up to `limit`. Before, any nearby sketch replaced the whole feed,
    so one sketch nearby meant a one-sketch Home. Each card carries
    `near: true` when it is within radius_km. No coordinates: the latest.

    Registered ABOVE /sketches/{sketch_id} on purpose -- FastAPI matches
    routes in file order, and "recent" would otherwise be swallowed as a
    (nonexistent) sketch_id. Feedback text is never included (public).
    """
    limit = max(1, min(limit, 60))
    nearby = []
    if lat is not None and lon is not None:
        point = WKTElement(f"POINT({lon} {lat})", srid=4326)
        nearby = (
            card_query(db)
            .filter(visible_filter(viewer_id))
            .filter(Sketch.location.isnot(None))
            .filter(ST_DWithin(Sketch.location, point, radius_km * 1000))
            .order_by(ST_Distance(Sketch.location, point))
            .limit(limit)
            .all()
        )
    near_ids = {s.id for s in nearby}
    rest = []
    if len(nearby) < limit:
        q = card_query(db).filter(visible_filter(viewer_id))
        if near_ids:
            q = q.filter(Sketch.id.notin_(near_ids))
        rest = q.order_by(Sketch.created_at.desc()).limit(limit - len(nearby)).all()
    rows = nearby + rest
    out = _with_owners(db, rows, viewer_id)
    for d in out:
        d["near"] = d["id"] in near_ids
    return out


def _with_owners(db: Session, rows: list, viewer_id: str | None) -> list[dict]:
    """Public cards with the sketcher's name and username, and likes."""
    ids = {s.sketcher_id for s in rows}
    owners = {p.id: p for p in db.query(Profile).filter(Profile.id.in_(ids)).all()} if ids else {}
    drafts = upload_counts(db, [s.id for s in rows if not s.final_sketch_url])
    dicts = []
    for s in rows:
        d = _sketch_card(s)
        d["upload_count"] = drafts.get(s.id, 0)
        p = owners.get(s.sketcher_id)
        d["owner"] = {"display_name": p.display_name if p else None, "username": p.username if p else None,
                      "avatar_url": p.avatar_url if p else None}  # Explore's avatar pins
        dicts.append(d)
    return _with_likes(db, rows, viewer_id, dicts)


def _visible_to(viewer_id: str | None):
    """Search and Explore: shared sketches the viewer may see (members, or
    followers-only when they follow the owner, or their own). Drafts stay
    on the sketcher's own page (core/visibility.py)."""
    return visible_filter(viewer_id)


@router.get("/sketches/search")
async def search_sketches(
    q: str = "",
    limit: int = 60,
    db: Session = Depends(get_db),
    viewer_id: str | None = Depends(get_optional_sketcher_id),
):
    """
    Generic search (the Search page): shared sketches whose sketcher's name
    or username, title, or place label contains the text, plus the sketches
    inside any town, city or country the text names (Nominatim's bounding
    box), so "Japan" finds a sketch labelled "Gion, Kyoto". Newest first.
    Registered above /sketches/{sketch_id}, like /sketches/recent.
    """
    q = q.strip()
    if len(q) < 2:
        return []
    like = f"%{q}%"
    text = (
        card_query(db)
        .outerjoin(Profile, Profile.id == Sketch.sketcher_id)
        .filter(_visible_to(viewer_id))
        .filter(or_(
            Sketch.title.ilike(like),
            Sketch.location_label.ilike(like),
            Profile.display_name.ilike(like),
            Profile.username.ilike(like),
        ))
    )
    found = {s.id: s for s in text.all()}
    boxes = await place_boxes(q)
    if boxes:
        geom = cast(Sketch.location, Geometry(srid=4326))
        inside = or_(*[func.ST_Intersects(geom, func.ST_MakeEnvelope(w, s, e, n, 4326)) for s, n, w, e in boxes])
        for s in (
            card_query(db)
            .filter(_visible_to(viewer_id), Sketch.location.isnot(None))
            .filter(inside)
            .all()
        ):
            found[s.id] = s
    rows = sorted(found.values(), key=lambda s: s.created_at, reverse=True)[: max(1, min(limit, 200))]
    return _with_owners(db, rows, viewer_id)


@router.get("/sketches/explore")
def explore_sketches(
    south: float,
    west: float,
    north: float,
    east: float,
    since_days: Optional[int] = None,
    mine: bool = False,
    limit: int = 200,
    db: Session = Depends(get_db),
    viewer_id: str | None = Depends(get_optional_sketcher_id),
):
    """
    The Explore map: shared sketches inside the map's view, newest first,
    made in the last since_days days (none: any time). mine: only the
    viewer's own, drafts included: their sketching trail.
    """
    geom = cast(Sketch.location, Geometry(srid=4326))
    seen = (and_(Sketch.sketcher_id == viewer_id) if mine and viewer_id else _visible_to(viewer_id))
    query = (
        card_query(db)
        .filter(seen, Sketch.location.isnot(None))
        .filter(func.ST_Intersects(geom, func.ST_MakeEnvelope(west, south, east, north, 4326)))
    )
    if since_days:
        query = query.filter(Sketch.created_at >= datetime.now(timezone.utc) - timedelta(days=since_days))
    rows = query.order_by(Sketch.created_at.desc()).limit(max(1, min(limit, 500))).all()
    return _with_owners(db, rows, viewer_id)


# Country names, to tell a city from a country at the end of a place name
# ("Sintra, Portugal": the city is Sintra). City-states such as Singapore
# and Hong Kong are left out: there the country is the city.
COUNTRIES = {
    'Afghanistan',
    'Albania',
    'Algeria',
    'Andorra',
    'Angola',
    'Argentina',
    'Armenia',
    'Australia',
    'Austria',
    'Azerbaijan',
    'Bahamas',
    'Bahrain',
    'Bangladesh',
    'Barbados',
    'Belarus',
    'Belgium',
    'Belize',
    'Benin',
    'Bhutan',
    'Bolivia',
    'Bosnia and Herzegovina',
    'Botswana',
    'Brazil',
    'Brunei',
    'Bulgaria',
    'Burkina Faso',
    'Burundi',
    'Cabo Verde',
    'Cambodia',
    'Cameroon',
    'Canada',
    'Cape Verde',
    'Central African Republic',
    'Chad',
    'Chile',
    'China',
    'Colombia',
    'Comoros',
    'Congo',
    'Costa Rica',
    'Croatia',
    'Cuba',
    'Cyprus',
    'Czech Republic',
    'Czechia',
    "Côte d'Ivoire",
    'Denmark',
    'Djibouti',
    'Dominica',
    'Dominican Republic',
    'East Timor',
    'Ecuador',
    'Egypt',
    'El Salvador',
    'Equatorial Guinea',
    'Eritrea',
    'Estonia',
    'Eswatini',
    'Ethiopia',
    'Fiji',
    'Finland',
    'France',
    'Gabon',
    'Gambia',
    'Georgia',
    'Germany',
    'Ghana',
    'Greece',
    'Grenada',
    'Guatemala',
    'Guinea',
    'Guyana',
    'Haiti',
    'Honduras',
    'Hungary',
    'Iceland',
    'India',
    'Indonesia',
    'Iran',
    'Iraq',
    'Ireland',
    'Israel',
    'Italy',
    'Ivory Coast',
    'Jamaica',
    'Japan',
    'Jordan',
    'Kazakhstan',
    'Kenya',
    'Kiribati',
    'Kosovo',
    'Kuwait',
    'Kyrgyzstan',
    'Laos',
    'Latvia',
    'Lebanon',
    'Lesotho',
    'Liberia',
    'Libya',
    'Liechtenstein',
    'Lithuania',
    'Luxembourg',
    'Madagascar',
    'Malawi',
    'Malaysia',
    'Maldives',
    'Mali',
    'Malta',
    'Marshall Islands',
    'Mauritania',
    'Mauritius',
    'Mexico',
    'Micronesia',
    'Moldova',
    'Mongolia',
    'Montenegro',
    'Morocco',
    'Mozambique',
    'Myanmar',
    'Namibia',
    'Nauru',
    'Nepal',
    'Netherlands',
    'New Zealand',
    'Nicaragua',
    'Niger',
    'Nigeria',
    'North Korea',
    'North Macedonia',
    'Norway',
    'Oman',
    'Pakistan',
    'Palau',
    'Palestine',
    'Panama',
    'Papua New Guinea',
    'Paraguay',
    'Peru',
    'Philippines',
    'Poland',
    'Portugal',
    'Puerto Rico',
    'Qatar',
    'Romania',
    'Russia',
    'Rwanda',
    'Saint Lucia',
    'Samoa',
    'Saudi Arabia',
    'Senegal',
    'Serbia',
    'Seychelles',
    'Sierra Leone',
    'Slovakia',
    'Slovenia',
    'Solomon Islands',
    'Somalia',
    'South Africa',
    'South Korea',
    'South Sudan',
    'Spain',
    'Sri Lanka',
    'Sudan',
    'Suriname',
    'Sweden',
    'Switzerland',
    'Syria',
    'Taiwan',
    'Tajikistan',
    'Tanzania',
    'Thailand',
    'Timor-Leste',
    'Togo',
    'Tonga',
    'Trinidad and Tobago',
    'Tunisia',
    'Turkey',
    'Turkmenistan',
    'Tuvalu',
    'Türkiye',
    'Uganda',
    'Ukraine',
    'United Arab Emirates',
    'United Kingdom',
    'United States',
    'United States of America',
    'Uruguay',
    'Uzbekistan',
    'Vanuatu',
    'Venezuela',
    'Vietnam',
    'Yemen',
    'Zambia',
    'Zimbabwe',
}


# The place pills change slowly: 5 minutes per viewer (what they may see
# depends on whom they follow).
PLACES_CACHE = TTLCache(seconds=300)


@router.get("/explore/places")
def explore_places(
    limit: int = 5,
    db: Session = Depends(get_db),
    viewer_id: str | None = Depends(get_optional_sketcher_id),
):
    """
    The Explore map's place pills: the cities with the most shared sketches
    the viewer may see, most first, each with the area its sketches cover.
    The city is the last part of a sketch's place name ("Gion, Kyoto" ->
    Kyoto), as reverse_geocode writes it, or the part before a country
    ("Sintra, Portugal" -> Sintra).
    """
    key = (viewer_id, limit)
    hit = PLACES_CACHE.get(key)
    if hit is not None:
        return hit
    geom = cast(Sketch.location, Geometry(srid=4326))
    rows = (
        db.query(Sketch.location_label, func.ST_Y(geom), func.ST_X(geom))
        .filter(_visible_to(viewer_id), Sketch.location.isnot(None), Sketch.location_label.isnot(None))
        .all()
    )
    places: dict[str, dict] = {}
    for label, lat, lon in rows:
        parts = [x.strip() for x in (label or "").split(",") if x.strip()]
        while len(parts) > 1 and parts[-1] in COUNTRIES:
            parts.pop()
        city = parts[-1] if parts else ""
        if not city:
            continue
        p = places.setdefault(city.lower(), {"label": city, "count": 0, "lats": [], "lons": []})
        p["count"] += 1
        p["lats"].append(lat)
        p["lons"].append(lon)
    top = sorted(places.values(), key=lambda p: -p["count"])[: max(1, min(limit, 10))]
    out = []
    for p in top:
        s, n, w, e = min(p["lats"]), max(p["lats"]), min(p["lons"]), max(p["lons"])
        pad = 0.01  # about a kilometre, so a single sketch is not a point
        out.append({"label": p["label"], "count": p["count"], "lat": (s + n) / 2, "lon": (w + e) / 2,
                    "bbox": [s - pad, n + pad, w - pad, e + pad]})
    return PLACES_CACHE.put(key, out)


@router.get("/sketch-media/last")
async def last_media(
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """The media card's picks from the sketcher's most recent sketch that
    has them (design doc, item 25), to pre-fill the next sketch's card."""
    recent = (
        db.query(Sketch)
        .filter(Sketch.sketcher_id == sketcher_id)
        .order_by(Sketch.created_at.desc())
        .limit(20)
        .all()
    )
    for sk in recent:
        for c in sk.session_choices or []:
            if c.get("key") == "media" and c.get("media"):
                return {"media": c["media"]}
    return {"media": []}


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
    # A sketch is shared once it has a final sketch (design doc, item 30).
    # Before that, it is the owner's alone.
    if not sketch.final_sketch_url and not is_owner:
        raise HTTPException(404, "This sketch isn't shared yet")
    # Shared: by the owner's choice (members, followers, private).
    if not can_see(db, sketch, sketcher_id):
        raise HTTPException(404, "Sketch not found")

    # The sketch owner's public name and avatar, shown at the top of the
    # sketch's right panel. Public, like the profile itself.
    owner_profile = db.query(Profile).filter(Profile.id == sketch.sketcher_id).first()
    owner = {
        "display_name": owner_profile.display_name if owner_profile else None,
        "avatar_url": owner_profile.avatar_url if owner_profile else None,
        "username": owner_profile.username if owner_profile else None,
    }
    # Likes and comments (design doc, items 32 and 33), for everyone.
    from app.features.community.router import comment_count, is_following, like_count, liked_by
    # For the Follow button beside the owner's name.
    owner["is_following"] = bool(owner_profile) and not is_owner and is_following(db, sketcher_id, owner_profile.id)
    social = {
        "like_count": like_count(db, sketch.id),
        "liked": liked_by(db, sketcher_id, sketch.id),
        "comment_count": comment_count(db, sketch.id),
    }
    cleaned = ((sketch.cached_scene_analysis or {}).get("marks_analysis") or {}).get("cleaned") or {}

    if not is_owner:
        data = _sketch_to_dict(sketch)
        data.update(social)
        data["owner"] = owner
        data["is_owner"] = False
        # Visitors get a short plan: the principles the plan carries, by
        # name, without the tips or the sketcher's rating and bookmarks.
        principles = (cleaned.get("plan_read") or {}).get("principles") or []
        data["plan_short"] = [p.get("principle") for p in principles if p.get("group") in ("strong", "moderate")][:3]
        data["media"] = cleaned.get("media") or []
        data["uploads"] = uploads_to_list(sketch, _uploads(db, sketch.id))
        return data

    critiques = (
        db.query(CritiqueResponse)
        .filter(CritiqueResponse.sketch_id == sketch_id)
        .order_by(CritiqueResponse.created_at.asc())
        .all()
    )
    data = _sketch_to_dict(sketch, critiques[-1].critique if critiques else None)
    # DEBUG=true only: the owner can open the last marks analysis report.
    data["debug_report"] = DEBUG and (DEBUG_DIR / f"marks_report_{sketch.id}.html").exists()
    data["critiques"] = [
        {
            "critique": c.critique,
            "decision_trace": c.decision_trace,
            "final_sketch_provided": c.final_sketch_provided,
            "created_at": c.created_at,
        }
        for c in critiques
    ]
    data.update(social)
    data["owner"] = owner
    data["critique_status"] = sketch.critique_status
    # Scene analysis rows on the sketch page (owner only).
    scene = sketch.cached_scene_analysis or {}
    data["scene"] = {"summary": scene.get("scene_summary"), "scene_type": sketch.scene_type or scene.get("scene_type")}
    # The sketcher's guided answers, so the Guide tab can show their picks.
    data["session_choices"] = _with_options(sketch)
    # The plan read they saw (design doc, item 25), from the cache, so Edit
    # Sketch shows the card without another call. None before item 25.
    data["plan_read"] = cleaned.get("plan_read")
    data["media"] = cleaned.get("media") or []
    # The focal areas to consider, under the plan read.
    if cleaned.get("plan_read"):
        from app.features.marks_analysis.service import focal_list
        data["focal_suggestions"] = focal_list(sketch, sketch.cached_scene_analysis)
    data["uploads"] = uploads_to_list(sketch, _uploads(db, sketch.id))
    data["persona_id"] = sketch.persona_id
    # The voice Upload sketch starts on: this sketch's, else the one behind
    # the sketcher's latest feedback (None is "Your coach").
    if sketch.final_sketch_url:
        data["voice_default"] = sketch.persona_id
    else:
        last = (
            db.query(Sketch.persona_id)
            .join(CritiqueResponse, CritiqueResponse.sketch_id == Sketch.id)
            .filter(Sketch.sketcher_id == sketch.sketcher_id)
            .order_by(CritiqueResponse.created_at.desc())
            .first()
        )
        data["voice_default"] = last[0] if last else None
    data["is_owner"] = True
    return data


NEARBY_RADIUS_M = 300
MAX_PALETTE = 12


@router.get("/sketches/{sketch_id}/nearby")
def nearby_sketches(
    sketch_id: str,
    radius_m: int = NEARBY_RADIUS_M,
    limit: int = 24,
    db: Session = Depends(get_db),
    sketcher_id: str | None = Depends(get_optional_sketcher_id),
):
    """Other shared sketches within radius_m of this one, nearest first
    (design doc, item 29: "Other sketches near here")."""
    sketch = db.query(Sketch).filter(Sketch.id == sketch_id).first()
    if sketch is None or not can_see(db, sketch, sketcher_id):
        raise HTTPException(404, "Sketch not found")
    if sketch.location is None:
        return []
    radius_m = max(50, min(radius_m, 5000))
    dist = ST_Distance(Sketch.location, sketch.location)
    rows = (
        card_query(db, dist.label("distance_m"), Profile)
        .outerjoin(Profile, Profile.id == Sketch.sketcher_id)
        .filter(Sketch.id != sketch.id, visible_filter(sketcher_id), Sketch.location.isnot(None))
        .filter(ST_DWithin(Sketch.location, sketch.location, radius_m))
        .order_by(dist)
        .limit(max(1, min(limit, 60)))
        .all()
    )
    out = []
    for s, d, p in rows:
        item = _sketch_card(s)
        item["distance_m"] = round(d or 0)
        item["owner"] = {"display_name": p.display_name if p else None, "username": p.username if p else None}
        out.append(item)
    return out


class PaletteRequest(BaseModel):
    """The final sketch's closest paints, corrected by the sketcher: paint
    ids from the paint list (frontend data/paints.js)."""
    sketch: list[str]


@router.put("/sketches/{sketch_id}/palette")
async def update_palette(
    sketch_id: str,
    body: PaletteRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    sketch = db.query(Sketch).filter(Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")
    ids = [i for i in body.sketch if re.match(r"^[a-z0-9][a-z0-9_-]{0,40}$", i)][:MAX_PALETTE]
    sketch.palettes = {**(sketch.palettes or {}), "sketch": ids}
    db.commit()
    return {"palettes": sketch.palettes}


# ---- Sketch uploads: progress sketches and the final (design doc, items
# 35 and 38). The final is the upload whose url is sketches.final_sketch_url;
# setting it shares the sketch and runs the critique. Deleting it unshares
# the sketch and unlocks the plan.

MAX_SKETCH_UPLOADS = 10


def _owned_sketch(db: Session, sketch_id: str, sketcher_id: str) -> Sketch:
    sketch = db.query(Sketch).filter(Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")
    return sketch


def _uploads(db: Session, sketch_id: str) -> list:
    return (
        db.query(SketchUpload)
        .filter(SketchUpload.sketch_id == sketch_id)
        .order_by(SketchUpload.position.asc(), SketchUpload.created_at.asc())
        .all()
    )


def uploads_to_list(sketch: Sketch, rows: list) -> list[dict]:
    return [
        {"id": u.id, "url": u.url, "position": i, "created_at": u.created_at, "is_final": u.url == sketch.final_sketch_url}
        for i, u in enumerate(rows)
    ]


def upload_counts(db: Session, sketch_ids: list[str]) -> dict:
    """{sketch_id: number of uploads}, for the status labels on the cards."""
    if not sketch_ids:
        return {}
    from sqlalchemy import func
    return dict(
        db.query(SketchUpload.sketch_id, func.count())
        .filter(SketchUpload.sketch_id.in_(sketch_ids))
        .group_by(SketchUpload.sketch_id)
        .all()
    )


def _check_persona(db: Session, persona_id: Optional[str], sketcher_id: str) -> None:
    if not persona_id:
        return
    if not _is_uuid(persona_id) or db.query(Persona).filter(
        Persona.id == persona_id, Persona.sketcher_id == sketcher_id
    ).first() is None:
        raise HTTPException(400, "That voice isn't on your admired sketchers list")


def _make_final(db: Session, sketch: Sketch, upload: SketchUpload, persona_id: Optional[str], background_tasks: BackgroundTasks) -> None:
    """Share the sketch with this upload as its final, and run the critique."""
    sketch.final_sketch_url = upload.url
    sketch.final_sketch_provided = True
    sketch.persona_id = persona_id or None
    start_critique(db, sketch, background_tasks)  # commits


def _uploads_response(db: Session, sketch: Sketch) -> dict:
    db.refresh(sketch)
    return {
        "uploads": uploads_to_list(sketch, _uploads(db, sketch.id)),
        "final_sketch_url": sketch.final_sketch_url,
        "critique_status": sketch.critique_status,
    }


@router.post("/sketches/{sketch_id}/uploads")
async def add_upload(
    sketch_id: str,
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    final: bool = Form(False),
    persona_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """Add a progress sketch, or a final sketch (final=true), which shares
    the sketch and runs the critique in the background."""
    sketch = _owned_sketch(db, sketch_id, sketcher_id)
    rows = _uploads(db, sketch_id)
    if len(rows) >= MAX_SKETCH_UPLOADS:
        raise HTTPException(400, f"A sketch holds up to {MAX_SKETCH_UPLOADS} uploads. Delete one first.")
    if final:
        _check_persona(db, persona_id, sketcher_id)
        if sketch.critique_status == "pending":
            raise HTTPException(409, "Feedback is still being prepared for the last final sketch")

    contents = await image.read()
    try:
        pil_image = ImageOps.exif_transpose(Image.open(io.BytesIO(contents))).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not read that image")
    filename = f"{uuid.uuid4()}.jpg"
    pil_image.save(UPLOAD_DIR / filename, format="JPEG", quality=90)

    upload = SketchUpload(
        sketch_id=sketch.id, sketcher_id=sketcher_id, url=f"/uploads/{filename}",
        position=(max((u.position for u in rows), default=-1) + 1),
    )
    db.add(upload)
    db.commit()
    if final:
        _make_final(db, sketch, upload, persona_id, background_tasks)
    return _uploads_response(db, sketch)


class MakeFinalRequest(BaseModel):
    persona_id: Optional[str] = None


@router.post("/sketches/{sketch_id}/uploads/{upload_id}/final")
async def make_final(
    sketch_id: str,
    upload_id: str,
    body: MakeFinalRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """Make an upload the final sketch: shares the sketch, runs the critique."""
    sketch = _owned_sketch(db, sketch_id, sketcher_id)
    upload = db.query(SketchUpload).filter(SketchUpload.id == upload_id, SketchUpload.sketch_id == sketch_id).first() if _is_uuid(upload_id) else None
    if upload is None:
        raise HTTPException(404, "Upload not found")
    _check_persona(db, body.persona_id, sketcher_id)
    if sketch.critique_status == "pending":
        raise HTTPException(409, "Feedback is still being prepared for the last final sketch")
    _make_final(db, sketch, upload, body.persona_id, background_tasks)
    return _uploads_response(db, sketch)


@router.delete("/sketches/{sketch_id}/uploads/{upload_id}")
async def delete_upload(
    sketch_id: str,
    upload_id: str,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """Delete an upload. Deleting the final unshares the sketch and unlocks
    the plan; its feedback stays in the history."""
    sketch = _owned_sketch(db, sketch_id, sketcher_id)
    upload = db.query(SketchUpload).filter(SketchUpload.id == upload_id, SketchUpload.sketch_id == sketch_id).first() if _is_uuid(upload_id) else None
    if upload is None:
        raise HTTPException(404, "Upload not found")
    if upload.url == sketch.final_sketch_url:
        if sketch.critique_status == "pending":
            raise HTTPException(409, "Feedback is still being prepared for this sketch")
        sketch.final_sketch_url = None
        sketch.final_sketch_provided = False
        sketch.critique_status = None
    _delete_upload_file(upload.url)
    db.delete(upload)
    db.commit()
    return _uploads_response(db, sketch)


class UploadOrderRequest(BaseModel):
    ids: list[str]


@router.put("/sketches/{sketch_id}/uploads/order")
async def order_uploads(
    sketch_id: str,
    body: UploadOrderRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """Set the uploads' order. `ids` lists every upload of the sketch."""
    sketch = _owned_sketch(db, sketch_id, sketcher_id)
    rows = {u.id: u for u in _uploads(db, sketch_id)}
    if sorted(body.ids) != sorted(rows):
        raise HTTPException(400, "List every upload of this sketch, once")
    for i, uid in enumerate(body.ids):
        rows[uid].position = i
    db.commit()
    return _uploads_response(db, sketch)


# ---- The Value and Color tabs (design doc, item 37) ----

class MaskPoint(BaseModel):
    h: float  # hue, 0-360 (the Yurmby wheel is the screen colour wheel)
    c: float  # intensity, 0 (grey centre) to 1 (rim)
    paint_id: Optional[str] = None  # older masks only


class MaskShape(BaseModel):
    type: str  # 'polygon' | 'circle'
    corners: Optional[list[MaskPoint]] = None
    center: Optional[MaskPoint] = None
    r: Optional[float] = None


class MaskSwatch(BaseModel):
    h: float
    c: float
    hex: str
    x: Optional[float] = None  # where it was dropped on the reference, 0-1 from the top left
    y: Optional[float] = None


class GamutMask(BaseModel):
    shapes: Optional[list[MaskShape]] = None
    swatches: Optional[list[MaskSwatch]] = None  # tiles collected from the wheel
    corners: Optional[list[MaskPoint]] = None  # older masks: one polygon


class StudiesRequest(BaseModel):
    value_levels: Optional[int] = None
    gamut_mask: Optional[GamutMask] = None
    clear_mask: bool = False


MAX_MASK_SHAPES = 4
MAX_SHAPE_CORNERS = 8


def _clean_point(p: MaskPoint) -> dict:
    return {"h": round(p.h % 360, 1), "c": round(max(0.0, min(1.0, p.c)), 3)}


def _clean_mask(mask: GamutMask) -> dict:
    """Shapes on the wheel (Krita-style gamut masks, design doc, item 37)."""
    shapes = mask.shapes or ([MaskShape(type="polygon", corners=mask.corners)] if mask.corners else [])
    out = []
    for s in shapes[:MAX_MASK_SHAPES]:
        if s.type == "polygon" and s.corners and len(s.corners) >= 3:
            out.append({"type": "polygon", "corners": [_clean_point(c) for c in s.corners[:MAX_SHAPE_CORNERS]]})
        elif s.type == "circle" and s.center and s.r:
            out.append({"type": "circle", "center": _clean_point(s.center), "r": round(max(0.02, min(1.0, s.r)), 3)})
    # No shapes: the sketcher removed the mask.
    return {"shapes": out, "swatches": _clean_swatches(mask.swatches)}


def _clean_swatches(swatches) -> list[dict]:
    return [
        {
            **_clean_point(MaskPoint(h=s.h, c=s.c)),
            "hex": s.hex.lower(),
            **({"x": round(min(1.0, max(0.0, s.x)), 3), "y": round(min(1.0, max(0.0, s.y)), 3)} if s.x is not None and s.y is not None else {}),
        }
        for s in (swatches or [])[:16]
        if re.match(r"^#[0-9a-fA-F]{6}$", s.hex)
    ]


@router.put("/sketches/{sketch_id}/studies")
async def save_studies(
    sketch_id: str,
    body: StudiesRequest,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """Saves the value study's number of values and the gamut mask. The
    mask is part of the plan, so it locks once the final sketch is in."""
    sketch = _owned_sketch(db, sketch_id, sketcher_id)
    if body.value_levels is not None:
        if body.value_levels not in (3, 5, 7, 9):
            raise HTTPException(400, "Pick 3, 5, 7 or 9 values")
        sketch.value_levels = body.value_levels
    if body.gamut_mask is not None or body.clear_mask:
        if sketch.final_sketch_url:
            # The shapes lock with the plan; the collected colours do not.
            if body.gamut_mask is not None and sketch.gamut_mask:
                sketch.gamut_mask = {**sketch.gamut_mask, "swatches": _clean_swatches(body.gamut_mask.swatches)}
                db.commit()
                return {"value_levels": sketch.value_levels, "gamut_mask": sketch.gamut_mask}
            raise HTTPException(409, "The plan can't change once the final sketch is uploaded")
        if body.clear_mask:
            sketch.gamut_mask = None
        else:
            sketch.gamut_mask = _clean_mask(body.gamut_mask)
    db.commit()
    return {"value_levels": sketch.value_levels, "gamut_mask": sketch.gamut_mask}

