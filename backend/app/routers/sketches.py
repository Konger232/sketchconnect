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
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from PIL import Image, ImageOps
import pillow_heif
from sqlalchemy.orm import Session
from geoalchemy2.shape import to_shape
from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_Distance, ST_DWithin

from ..database import get_db
from ..auth import get_current_sketcher_id, get_optional_sketcher_id
from ..models import Sketch, CritiqueResponse
from ..schemas import SketchUpdateRequest, SketcherFocalPointInput, FocalRegion
from ..services.exif_utils import extract_location_and_time
from ..services.focal_pairing import pair_focal_points
from ..services.value_study import compute_value_study

# Registered again here (also done in scene_analysis.py) so this module
# decodes HEIC/HEIF correctly even if imported before that one — the
# registration is process-global, but this keeps the module correct in
# isolation rather than relying on router import order.
pillow_heif.register_heif_opener()

router = APIRouter(prefix="/api", tags=["sketches"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
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
        # Gemini's own suggested focal regions (label + contour), so
        # FocalFrameEditor.jsx can re-offer any of these the sketcher
        # hasn't already adopted when it's reopened from EditSketch.jsx
        # -- previously only surfaced during the original capture flow,
        # never persisted back out to the frontend after the fact.
        "focal_regions": (s.cached_scene_analysis or {}).get("focal_regions", []),
        "perspective_lines": (s.cached_scene_analysis or {}).get("perspective_lines", []),
        "created_at": s.created_at,
        # The latest critique's text, if any -- this is what
        # SketchCard.jsx's feed view shows as the sketch's description,
        # with a Read more/Show less toggle once it runs long. None (not
        # "") when nothing's been critiqued yet, so the frontend can tell
        # "no feedback yet" apart from "feedback text that happens to be
        # empty" via a null check rather than string truthiness.
        "critique": latest_critique,
    }


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
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    Persists the result of FocalFrameEditor.jsx's mark-then-frame-refine
    flow (frontend: FocalFrameEditor.jsx, geometry: lib/focalGeometry.js;
    backend geometry: services/focal_pairing.py -- see that file's own
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
    updated, and -- since focal_regions/perspective_lines were computed
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


@router.get("/sketches/{sketch_id}/value-study")
async def sketch_value_study(
    sketch_id: str,
    levels: int = 4,
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """
    On-demand "dominant value shapes" toggle for SketchDetailPage's
    edit-mode view (see services/value_study.py's docstring for the
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

    for url in {sketch.original_image_url, sketch.reference_image_url}:
        _delete_upload_file(url)

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
        .filter(Sketch.sketcher_id == sketcher_id)
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
            .filter(Sketch.location.isnot(None))
            .filter(ST_DWithin(Sketch.location, point, radius_km * 1000))
            .order_by(ST_Distance(Sketch.location, point))
            .limit(limit)
            .all()
        )
        if nearby:
            return [_sketch_to_dict(s) for s in nearby]

    rows = db.query(Sketch).order_by(Sketch.created_at.desc()).limit(limit).all()
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
    if not is_owner:
        data = _sketch_to_dict(sketch)
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
    data["is_owner"] = True
    return data
