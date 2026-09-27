"""
Scene analysis call: fires once per reference photo (design doc, Section 5,
steps 1-4; schema: gemini_call_schemas.md #1).

This module owns everything about the Gemini call itself -- the response
schema, the prompt (prompts/scene_analysis*.md), and cleaning Gemini's
answer. The HTTP route, caching and database writes stay in
features/scene_analysis/router.py.

Always sent the clean framed reference photo, never the planning image, so
the sketcher's own marks can't be mistaken for scene content.
"""
from pathlib import Path

from PIL import Image

from config import MAX_IMAGE_DIMENSION
from app.core.prompt_loader import render_prompt
from app.core import rules
from app.core.gemini_service import call_gemini_json_with_raw

PROMPTS = Path(__file__).parent / "prompts"

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



def resize_if_needed(pil_image: Image.Image, max_dim=MAX_IMAGE_DIMENSION) -> Image.Image:
    w, h = pil_image.size
    if max(w, h) <= max_dim:
        return pil_image
    scale = max_dim / max(w, h)
    return pil_image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)



def build_prompt(style: str, crop_transform: dict | None = None) -> str:
    prompt = render_prompt(
        PROMPTS / "scene_analysis.md",
        style=style,
        prompt_guide=rules.render_prompt_guide(),
    )
    if crop_transform:
        # The sketcher's own pan/zoom/aspect-ratio choice, persisted as
        # Sketch.crop_transform. Gemini is already looking at the baked,
        # reframed photo; what the pixels alone can't tell it is that the
        # framing was a deliberate human choice and that any plain black
        # margins are empty space from that reframing.
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


def analyze(pil_image: Image.Image, style: str, crop_transform: dict | None = None) -> tuple[dict, str]:
    """
    Call Gemini on the (already resized) reference photo and return
    (cleaned result, raw Gemini text). Raises GeminiQuotaExceededError
    unchanged for the router to turn into a 429.
    """
    result, raw_gemini_text = call_gemini_json_with_raw(
        build_prompt(style, crop_transform), RESPONSE_SCHEMA, pil_image
    )
    if result.get("mixed_dominant_region") == "null":
        result["mixed_dominant_region"] = None

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

    # Readable summary of the actual decision: given this style + the
    # scene_type Gemini just classified, which prepared_prompts survived
    # the key/scene_type filtering above and are about to reach the
    # sketcher — separate from gemini_service.py's raw prompt/schema/response
    # dump, which shows what was sent/received but not what was decided.
    print("\n--- Scene Analysis decision ---")
    print(f"style: {style}  |  scene_type: {result['scene_type']}")
    print("prepared_prompts delivered to sketcher:")
    for p in result["prepared_prompts"]:
        print(f"  [{p['key']}] {p['question']}")
        print(f"      options: {p['options']}")
    print("--- end Scene Analysis decision ---\n")

    return result, raw_gemini_text
