"""
Scene analysis call: reads the framed reference photo only (design doc,
Section 5, and Section 11, item 20; schema: gemini_call_schemas.md #1).

Fires as soon as the sketcher confirms the crop, and runs while they draw
their marks. It needs nothing from the marks or the style, so a new mark
never re-runs it. The marks analysis call reads its result as text.

Returns the scene facts only: scene_summary, scene_type, suggested_title
and focal_regions. Perspective, proportions and the old guided questions
(prepared_prompts, mark_meanings, relationship) were dropped on the
scene-photo-only branch (October 6, 2026); the marks analysis call writes
the guided questions.

Images sent: the clean framed reference photo. Every coordinate comes from it.

This module owns the Gemini call (schema, prompt, cleaning). The HTTP
route, caching and database writes are in router.py.
"""
import hashlib
import json
from pathlib import Path

from PIL import Image

from config import DEBUG, MAX_IMAGE_DIMENSION, MAX_FOCAL_REGIONS, MAX_FOCAL_SUGGESTIONS
from app.core.prompt_loader import render_prompt
from app.core.gemini_service import call_gemini_json_with_raw
from app.core.schemas import FocalRegion
from app.features.sketches.focal_pairing import region_anchor, unmarked_region_indices
from app.features.sketches.schemas import SketcherFocalPointInput

PROMPTS = Path(__file__).parent / "prompts"

# Bump when the cleaned result changes shape. Part of the cache fingerprint,
# so a sketch analysed under an older version runs the call once more.
ANALYSIS_VERSION = 10  # 10: photo only, scene facts only; 9: option_mark_ids

SCENE_TYPES = ["architectural", "still_life_organic", "figure", "open_landscape", "mixed"]


def response_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "scene_summary": {
                "type": "string",
                "description": "One or two plain sentences: main subject, setting, light. No advice.",
            },
            "scene_type": {
                "type": "string",
                "enum": SCENE_TYPES,
                "description": (
                    "Reserve 'mixed' for a human figure competing with "
                    "architecture for attention in the same frame, not "
                    "merely a scene with more than one kind of object in it."
                ),
            },
            "suggested_title": {
                "type": "string",
                "description": (
                    "A short, natural title for this sketch scene itself, "
                    "not the sketching process, at most 8-10 words. Title "
                    "Case, no trailing punctuation, no quotes. Example: "
                    "'Sunset Over the Old Harbor Bridge'."
                ),
            },
            "focal_regions": {
                "type": "array",
                "description": "At most 3, strongest first.",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string", "description": "Short noun phrase, no article."},
                        "reason": {"type": "string", "description": "One sentence: why the eye lands here."},
                        "contour_points": {"type": "array", "items": {"type": "integer"}},
                    },
                    "required": ["label", "reason", "contour_points"],
                },
            },
        },
        "required": ["scene_summary", "scene_type", "suggested_title", "focal_regions"],
    }


def resize_if_needed(pil_image: Image.Image, max_dim=MAX_IMAGE_DIMENSION) -> Image.Image:
    w, h = pil_image.size
    if max(w, h) <= max_dim:
        return pil_image
    scale = max_dim / max(w, h)
    return pil_image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)


def frame_aspect(sketch, framed_image: Image.Image | None = None) -> float:
    """The framed photo's width / height: from framed_image, or from the
    saved reference photo's header (no full decode). 1.0 when unknown."""
    try:
        if framed_image is not None:
            w, h = framed_image.size
        else:
            from app.core.paths import UPLOAD_DIR
            with Image.open(UPLOAD_DIR / Path(sketch.reference_image_url).name) as im:
                w, h = im.size
        return w / h if h else 1.0
    except Exception:
        return 1.0


def photo_fingerprint(sketch) -> str:
    """
    Changes only when the photo or its framing changes. Marks, selection
    and style are not part of it: this call never sees them.
    """
    payload = {
        "version": ANALYSIS_VERSION,
        "reference": sketch.reference_image_url,
        "crop": sketch.crop_transform,
    }
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def build_prompt(crop_transform: dict | None = None) -> str:
    prompt = render_prompt(PROMPTS / "scene_analysis.md")
    if crop_transform:
        # The sketcher's own pan/zoom/aspect-ratio choice. Gemini already
        # sees the baked, reframed photo; what the pixels can't tell it is
        # that the framing was deliberate and that any plain black margins
        # are empty space from that reframing.
        zoom = crop_transform.get("zoom", 1)
        zoom_note = (
            "zoomed in for a tighter crop" if zoom > 1.05
            else "zoomed out, leaving intentional empty space around the subject" if zoom < 0.95
            else "at the photo's natural scale"
        )
        prompt += "\n\n" + render_prompt(
            PROMPTS / "scene_analysis_reframed.md",
            ratio=crop_transform.get("aspect_ratio", "original"),
            zoom_note=zoom_note,
        )
    return prompt


# ---------- Missed focal areas ----------

def build_focal_suggestions(
    regions: list[dict],
    focal_points: list[dict] | None,
    marks: list[dict] | None = None,
    aspect: float | None = 1.0,
) -> list[dict]:
    """
    The focal_regions the sketcher has not noticed, strongest first, capped
    at MAX_FOCAL_SUGGESTIONS. An area counts as noticed when a focal point
    sits on it or a mark runs through it, decided by geometry
    (focal_pairing.py). The marks analysis call asks about the rest.
    """
    models = [FocalRegion(**r) for r in regions]
    points = [
        SketcherFocalPointInput(x=round(p["x"]), y=round(p["y"]), source="own")
        for p in (focal_points or [])
        if p.get("x") is not None and p.get("y") is not None
    ]
    suggestions = []
    for i in unmarked_region_indices(points, models, marks, aspect):
        anchor = region_anchor(models[i])
        if anchor is None:
            continue
        suggestions.append({
            "region_ref": i,
            "label": models[i].label,
            "reason": models[i].reason,
            "x": anchor[0],
            "y": anchor[1],
        })
        if len(suggestions) >= MAX_FOCAL_SUGGESTIONS:
            break
    return suggestions


# ---------- The call ----------

def _clean_regions(raw_regions) -> list[dict]:
    """At most 3, malformed outlines dropped (FocalRegion needs 3 points)."""
    cleaned = []
    for r in (raw_regions or [])[:MAX_FOCAL_REGIONS]:
        pts = r.get("contour_points") if isinstance(r, dict) else None
        label = (r.get("label") or "").strip() if isinstance(r, dict) else ""
        if not label or not isinstance(pts, list) or len(pts) < 6:
            continue
        pts = [max(0, min(1000, int(p))) for p in pts if isinstance(p, (int, float))][:28]  # 14 points max
        if len(pts) % 2:
            pts = pts[:-1]
        if len(pts) < 6:
            continue
        cleaned.append({
            "id": f"a{len(cleaned) + 1}",
            "label": label,
            "reason": (r.get("reason") or "").strip() or None,
            "contour_points": pts,
            "points": [[pts[k], pts[k + 1]] for k in range(0, len(pts), 2)],
        })
    return cleaned


def analyze(pil_image: Image.Image, crop_transform: dict | None = None) -> tuple[dict, str]:
    """
    Call Gemini on the (already resized) framed photo and return
    (cleaned result, raw Gemini text). Raises GeminiQuotaExceededError
    unchanged for the router to turn into a 429.
    """
    raw, raw_text = call_gemini_json_with_raw(
        build_prompt(crop_transform), response_schema(), [pil_image], mock_name="scene_analysis",
    )
    scene_type = raw.get("scene_type") if raw.get("scene_type") in SCENE_TYPES else "mixed"
    result = {
        "scene_summary": (raw.get("scene_summary") or "").strip(),
        "scene_type": scene_type,
        "suggested_title": (raw.get("suggested_title") or "").strip() or None,
        "focal_regions": _clean_regions(raw.get("focal_regions")),
        # Stored with the result, so later geometry checks measure in the
        # same square units.
        "frame_aspect": round(pil_image.size[0] / pil_image.size[1], 4) if pil_image.size[1] else 1.0,
    }
    if DEBUG:
        print("\n--- Scene Analysis decision ---")
        print(f"scene_type: {result['scene_type']}  |  title: {result['suggested_title']!r}")
        print(f"summary: {result['scene_summary']}")
        for r in result["focal_regions"]:
            print(f"focal_region {r['id']}: {r['label']!r}  reason={r['reason']!r}")
        print("--- end Scene Analysis decision ---\n")
    return result, raw_text
