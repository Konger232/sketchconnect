"""
POST /api/scene-analysis — fires once per reference photo (design doc,
Section 5, steps 1-4; schema: gemini_call_schemas.md #1).
"""
import io
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from PIL import Image
import pillow_heif
from sqlalchemy.orm import Session
from geoalchemy2.elements import WKTElement

from app.services.gemini_client import call_gemini_json_with_raw, GeminiQuotaExceededError
from fastapi import HTTPException

from ..database import get_db
from ..auth import get_current_sketcher_id
from ..models import Sketch
from ..schemas import SceneAnalysisResponse
from ..services.gemini_client import call_gemini_json_with_raw
from ..services import rules
from ..services.exif_utils import extract_location_and_time
from .geocode import reverse_geocode
from config import MAX_IMAGE_DIMENSION

pillow_heif.register_heif_opener()

router = APIRouter(prefix="/api", tags=["scene-analysis"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "scene_type": {
            "type": "string",
            "enum": ["architectural", "still_life_organic", "figure", "open_landscape", "mixed"],
            "description": (
                "Reserve 'mixed' for a human figure competing with "
                "architecture for attention in the same frame -- not "
                "merely a scene with more than one kind of object in it."
            ),
        },
        "mixed_dominant_region": {
            "type": "string",
            "enum": ["architectural", "figure", "null"],
            "description": "Only meaningful when scene_type is 'mixed'; 'null' otherwise.",
        },
        "scene_summary": {"type": "string"},
        "suggested_title": {
            "type": "string",
            "description": (
                "A short, natural title for this sketch scene itself -- "
                "not the sketching process, not the style -- at most 8-10 "
                "words. Title Case, no trailing punctuation, no quotes. "
                "Example: 'Sunset Over the Old Harbor Bridge'."
            ),
        },
        "focal_regions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "contour_points": {
                        "type": "array",
                        "items": {"type": "integer"},
                    },
                },
                "required": ["label", "contour_points"],
            },
        },
        "perspective_lines": {
            "type": "array",
            "items": {"type": "integer"},
            "description": (
                "Optional. A flat [x1, y1, x2, y2, ...] list, 0-1000 scale, "
                "one 4-integer group per dominant real perspective/vanishing "
                "line actually visible in the photo (a building edge, "
                "sidewalk curb, railing, roofline, etc. that visibly "
                "converges toward a vanishing point). Trace each line "
                "along its real path in the photo -- never invent a line "
                "that isn't actually there. Return at most 4 lines (16 "
                "integers), strongest/most useful first. Return an empty "
                "array if the scene has no clear converging lines."
            ),
        },
        "prepared_prompts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "enum": rules.PROMPT_KEYS_ALL},
                    "question": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["key", "question", "options"],
            },
        },
    },
    "required": ["scene_type", "scene_summary", "suggested_title", "focal_regions", "prepared_prompts"],
}


def _resize_if_needed(pil_image: Image.Image, max_dim=MAX_IMAGE_DIMENSION) -> Image.Image:
    w, h = pil_image.size
    if max(w, h) <= max_dim:
        return pil_image
    scale = max_dim / max(w, h)
    return pil_image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)


def _build_prompt(style: str, crop_transform: dict | None = None) -> str:
    prompt_guide = rules.render_prompt_guide()
    prompt = (
        "You are observing a reference photo for an urban sketcher who is about "
        "to draw it on location, in the '"
        f"{style}"
        "' style. Classify the scene into exactly one scene_type using these "
        "definitions:\n"
        "- architectural: buildings, structures, streetscapes, or any other "
        "hard-edged built environment as the primary subject. This includes "
        "everyday objects such as bicycles, vehicles, market stalls, or "
        "signage when they sit within that built setting -- their presence "
        "does not make the scene \"mixed\"\n"
        "- still_life_organic: plants, food, or small object clusters viewed "
        "at close range, with no far horizon\n"
        "- figure: one or more people as the primary subject of the photo\n"
        "- open_landscape: sky-dominant natural terrain (ocean, beach, field) "
        "with no discrete buildings\n"
        "- mixed: use ONLY when a human figure or figures are a comparably "
        "prominent subject alongside architecture in the same frame -- for "
        "example a market or street scene where people are as visually "
        "central as the buildings. Do not use \"mixed\" just because the "
        "scene contains more than one kind of object -- a street of "
        "buildings with parked bicycles, signage, or vehicles and no "
        "prominent person is \"architectural\". mixed_dominant_region only "
        "ever resolves between \"architectural\" and \"figure\".\n\n"
        "Also give a \"suggested_title\" for this sketch scene: a short, "
        "natural title describing the scene itself (not the sketching "
        "process or the chosen style), at most 8-10 words, Title Case, no "
        "trailing punctuation or quotes.\n\n"
        "Then suggest a short list of guiding questions grounded in the "
        "Elements and Principles of Design (UC Berkeley Library design "
        "guide). Never tell the sketcher what to draw "
        "or how it should look — only observe and offer choices. Return at "
        "most 3 focal_regions -- the most visually distinct focal objects or "
        "shapes in the scene, the kind a sketcher would treat as separate "
        "objects to draw. For each, give a \"label\" and a \"contour_points\" "
        "array: a flat list of integers representing 8 to 14 (x, y) "
        "coordinate pairs, in order (x1, y1, x2, y2, x3, y3, ...), tracing "
        "the actual visible outline or silhouette of that object as closely "
        "as you can -- NOT a rectangular box. Coordinates are normalized to "
        "a 0-1000 scale relative to the photo's width and height (x is "
        "horizontal, y is vertical). Stay entirely within the real photo's "
        "own content -- if there are plain black margins from the sketcher's "
        "own reframing (see below), never trace a contour into them.\n\n"
        "If the photo has real converging structural lines -- building "
        "edges, a sidewalk or curb, a railing, a roofline -- that visibly "
        "run toward a vanishing point, also return \"perspective_lines\": "
        "a flat list of integers, 0-1000 scale, grouped in fours as "
        "(x1, y1, x2, y2) line segments, one group per line, each segment "
        "tracing that line's real path in the photo. Return at most 4 "
        "lines, strongest/most useful first. If the scene has no clear "
        "converging lines, return an empty array -- never invent a line "
        "that isn't actually visible in the photo.\n\n"
        "For prepared_prompts, you MUST choose only from the approved question "
        "bank below, matched to whichever scene_type you classify this photo "
        "as. Pick the entries from that scene_type's list that best fit what "
        "you actually see. Each item's \"key\" must be copied exactly as shown "
        "(e.g. \"perspective_lines\") from that scene_type's list — never a key "
        "from a different scene_type's list, and never a key not shown below. "
        "Adapt each seed question's wording in \"question\" to the specific "
        "scene (e.g. name the actual building, subject, or shapes) rather than "
        "reusing the generic phrasing verbatim, but keep \"key\" as the exact "
        "bank key it came from. Do the same for \"options\": adapt each seed "
        "option's wording to the specific scene, but keep the same number of "
        "options and the same kind of choice each one represents (if a seed "
        "option is a \"skip\" or \"do it differently\" choice, your adapted "
        "version should still be that kind of choice) rather than inventing "
        "new kinds of options:\n"
        f"{prompt_guide}"
    )
    if crop_transform:
        # The sketcher's own pan/zoom/aspect-ratio choice on the Capture
        # screen (CropFrame.jsx), persisted as Sketch.crop_transform. This
        # is NOT extra coordinates for Gemini to place a marker at --
        # Gemini is already looking at the baked, reframed photo itself
        # (whatever the sketcher composed is exactly what's in pil_image
        # below). What the pixels alone can't tell it is that the framing
        # was a deliberate human choice, not the camera's own default, and
        # that any plain black margins are empty space from that
        # reframing rather than real scene content -- both addressed here.
        ratio = crop_transform.get("aspect_ratio", "original")
        zoom = crop_transform.get("zoom", 1)
        zoom_note = (
            "zoomed in for a tighter crop" if zoom > 1.05
            else "zoomed out, leaving intentional empty space around the subject" if zoom < 0.95
            else "at the photo's natural scale"
        )
        prompt += (
            "\n\nThe sketcher deliberately reframed this photo before you're "
            "analyzing it — choosing a "
            f"{ratio} crop and {zoom_note}, and panning it to place their "
            "subject exactly where it sits in the frame now. Treat that "
            "placement as their own compositional choice (off-center, "
            "along a diagonal, tucked into a corner, etc.) — something "
            "that caught their attention, not something to second-guess "
            "or suggest recentering. If you see any plain black margins "
            "in the image, they're intentional empty space from this "
            "reframing, not part of the actual scene — never read them as "
            "sky, shadow, a wall, or any other scene content."
        )
    return prompt


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

    # Cache hit: a sketch's photo and crop_transform can never change after
    # creation (sketches.py has no route that edits either), so the only
    # thing that can make a previous analysis stale is a different style
    # -- Gemini adapts prepared_prompts wording/tone per style even though
    # scene_type itself is a property of the photo, not the style (design
    # doc, Section 2). Re-entering the same sketch with the same style
    # (Cancel then reopen, a page reload, SketchFlowPage's resume-on-load)
    # is a real, common case and shouldn't cost a fresh Gemini call.
    if sketch.style == style and sketch.cached_scene_analysis:
        # Backfill a still-missing title even on a cache hit -- a sketch
        # analyzed before suggested_title existed in this schema (or one
        # whose title was cleared some other way) would otherwise never
        # pick it up, since re-entering the same style always takes this
        # early-return path and skips the fresh-call logic below entirely.
        cached_title = (sketch.cached_scene_analysis.get("suggested_title") or "").strip()
        if cached_title and not sketch.title:
            sketch.title = cached_title[:150]
            db.commit()
        return sketch.cached_scene_analysis

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
    pil_image = _resize_if_needed(pil_image)

    try:
        result, raw_gemini_text = call_gemini_json_with_raw(
            _build_prompt(style, sketch.crop_transform), RESPONSE_SCHEMA, pil_image
        )
    except GeminiQuotaExceededError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    if result.get("mixed_dominant_region") == "null":
        result["mixed_dominant_region"] = None
    result["debug_raw_gemini_response"] = raw_gemini_text

    # Enum enforcement on the schema stops Gemini from inventing a key
    # outside the bank entirely, but a JSON Schema enum can't be scoped to
    # "only the keys valid for whichever scene_type ends up in this same
    # response" — so re-check that scoping here and drop anything that
    # leaked in from a different scene_type's list.
    allowed_keys = set(rules.eligible_prompt_keys(result["scene_type"]))
    result["prepared_prompts"] = [
        p for p in result.get("prepared_prompts", []) if p.get("key") in allowed_keys
    ]

    # focal_regions can no longer be capped/shape-checked at the schema
    # level (see the RESPONSE_SCHEMA comment above) — enforce both here.
    # schemas.py's FocalRegion requires contour_points to have at least 3
    # (x, y) points (an even-length list of >= 6 ints); dropping malformed
    # ones here avoids a 500 on response serialization if Gemini ever
    # strays from the prompt instruction, and clamping guards against a
    # stray coordinate landing outside the documented 0-1000 range.
    cleaned_regions = []
    for r in result.get("focal_regions", [])[:3]:
        pts = r.get("contour_points")
        if not isinstance(pts, list) or len(pts) < 6 or len(pts) % 2 != 0:
            continue
        pts = pts[:28]  # 14 points max, defensively -- schema has no maxItems (see above)
        r["contour_points"] = [max(0, min(1000, p)) for p in pts]
        cleaned_regions.append(r)
    result["focal_regions"] = cleaned_regions

    # perspective_lines: same defensive cleaning as focal_regions above --
    # optional field (Gemini can omit it or return an empty array when
    # there's nothing worth tracing), so treat anything malformed as "no
    # lines" rather than erroring the whole response.
    pts = result.get("perspective_lines")
    if not isinstance(pts, list):
        pts = []
    pts = [p for p in pts if isinstance(p, int)]
    pts = pts[: len(pts) - (len(pts) % 4)]  # drop a trailing partial segment
    pts = pts[:16]  # 4 lines max, defensively -- schema has no maxItems (see above)
    result["perspective_lines"] = [max(0, min(1000, p)) for p in pts]

    # A sketcher hasn't typed anything yet the first time a sketch reaches
    # this call (title entry is deferred entirely to EditSketch.jsx) --
    # fill it in from Gemini's suggestion so the sketch isn't stuck showing
    # "Untitled sketch" on the home feed while it's mid-flow. Never
    # overwrites a title the sketcher already has, including on a re-
    # analysis triggered by picking a different style.
    suggested_title = (result.get("suggested_title") or "").strip()
    if suggested_title and not sketch.title:
        sketch.title = suggested_title[:150]

    # Readable summary of the actual decision: given this style + the
    # scene_type Gemini just classified, which prepared_prompts survived
    # the key/scene_type filtering above and are about to reach the
    # sketcher — separate from gemini_client.py's raw prompt/schema/response
    # dump, which shows what was sent/received but not what was decided.
    print("\n--- Scene Analysis decision ---")
    print(f"style: {style}  |  scene_type: {result['scene_type']}")
    print("prepared_prompts delivered to sketcher:")
    for p in result["prepared_prompts"]:
        print(f"  [{p['key']}] {p['question']}")
        print(f"      options: {p['options']}")
    print("--- end Scene Analysis decision ---\n")

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
        had_location_already = sketch.location is not None
        sketch.location = WKTElement(f"POINT({location['lon']} {location['lat']})", srid=4326)
        if not had_location_already:
            label = await reverse_geocode(location["lat"], location["lon"])
            if label:
                sketch.location_label = label[:200]
    if captured_at:
        sketch.captured_at = captured_at
    db.commit()

    return result
