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
from ..auth import get_current_sketcher_id
from ..models import Sketch, CritiqueResponse
from ..schemas import SketchUpdateRequest
from ..services.exif_utils import extract_location_and_time

# Registered again here (also done in scene_analysis.py) so this module
# decodes HEIC/HEIF correctly even if imported before that one — the
# registration is process-global, but this keeps the module correct in
# isolation rather than relying on router import order.
pillow_heif.register_heif_opener()

router = APIRouter(prefix="/api", tags=["sketches"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


def _sketch_to_dict(s: Sketch) -> dict:
    location = None
    if s.location is not None:
        point = to_shape(s.location)
        location = {"lat": point.y, "lon": point.x}
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
        "created_at": s.created_at,
    }


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
    "leave as-is", not "clear this field").
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
    if body.location is not None:
        sketch.location = WKTElement(
            f"POINT({body.location.lon} {body.location.lat})", srid=4326
        )
    if body.style is not None:
        sketch.style = body.style
    if body.captured_at is not None:
        sketch.captured_at = body.captured_at

    db.commit()
    db.refresh(sketch)
    return _sketch_to_dict(sketch)


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
    return [_sketch_to_dict(s) for s in rows]


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
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """Detail view backing the 'Feedback Summary' tab: sketch + its critiques."""
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")

    critiques = (
        db.query(CritiqueResponse)
        .filter(CritiqueResponse.sketch_id == sketch_id)
        .order_by(CritiqueResponse.created_at.asc())
        .all()
    )
    data = _sketch_to_dict(sketch)
    data["critiques"] = [
        {
            "critique": c.critique,
            "decision_trace": c.decision_trace,
            "final_sketch_provided": c.final_sketch_provided,
            "created_at": c.created_at,
        }
        for c in critiques
    ]
    return data
