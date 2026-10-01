"""
Scene analysis call: fires once per reference photo (design doc, Section 5,
steps 1-4, and Section 11; schema: gemini_call_schemas.md #1).

This module owns everything about the Gemini call itself -- the response
schema, the prompt (prompts/scene_analysis*.md), the sketcher's plan as
input, and cleaning Gemini's answer. The HTTP route, caching and database
writes stay in features/scene_analysis/router.py.

Images sent, in order:
  1. the clean framed reference photo. Every coordinate comes from this one.
  2. the planning image (core/composite.py) -- same frame, with the
     sketcher's focal points and marks drawn on -- only when there are
     focal points or marks. Sent as context, never as scene content.
"""
import hashlib
import itertools
import json
import math
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from config import DEBUG, MAX_IMAGE_DIMENSION, MAX_FOCAL_SUGGESTIONS, MAX_MARK_MEANING_QUESTIONS
from app.core.prompt_loader import render_prompt
from app.core import composite
from app.core import debug, mark_geometry
from app.core.gemini_service import call_gemini_json_with_raw
from app.core.schemas import FocalRegion
from app.features.scene_analysis import question_bank
from app.features.sketches.focal_pairing import region_anchor, unmarked_region_indices
from app.features.sketches.schemas import SketcherFocalPointInput

PROMPTS = Path(__file__).parent / "prompts"

# Bump when the response gains or changes a field the app draws from, such
# as proportions. It is part of the cache fingerprint, so a sketch analysed
# under an older version runs the call once more instead of reusing a
# result that is missing the new field.
ANALYSIS_VERSION = 9  # 9: option_mark_ids; 8: relationship between marked subjects; 7: mark_meanings, focus and mark_ids (design doc, item 17)

PERSPECTIVE_KINDS = ["one_point", "two_point", "three_point", "none"]
# Eye level and vanishing points may sit outside the frame (0-1000).
OFF_FRAME_MIN, OFF_FRAME_MAX = -1000, 2000
# Vanishing points can sit much further out: upright edges in a photo taken
# looking up meet far above the frame, and gentle horizontals far to the side.
VP_MIN, VP_MAX = -20000, 21000
MAX_VANISHING_POINTS = 3
MAX_EDGES_PER_VP = 3
# How far (degrees) an edge's direction may miss its vanishing point and
# still count as running toward it.
EDGE_ANGLE_TOLERANCE = 6.0
# An edge set whose mean angle from horizontal is steeper than this
# belongs to a vertical (third) vanishing point, not one on eye level.
VERTICAL_EDGE_ANGLE = 60.0


def response_schema() -> dict:
    """
    Built per call, not at import: the prepared_prompts key enum comes from
    question_bank.json, which can change on disk without a restart.
    """
    return {
        "type": "object",
        "properties": {
            "scene_summary": {
                "type": "string",
                "description": "One or two plain sentences: main subject, setting, light. No advice.",
            },
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
                "description": "At most 3, strongest first, including missed opportunities.",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string", "description": "Short noun phrase, no article."},
                        "sketcher_marked": {"type": "boolean"},
                        "reason": {"type": "string", "description": "One sentence: why the eye lands here."},
                        "contour_points": {
                            "type": "array",
                            "items": {"type": "integer"},
                        },
                    },
                    "required": ["label", "sketcher_marked", "reason", "contour_points"],
                },
            },
            "perspective": {
                "type": "object",
                "description": "Eye level first, then vanishing points. Rules are in the prompt.",
                "properties": {
                    "eye_level_y": {
                        "type": "integer",
                        "description": "Horizontal eye level as a y value. May be below 0 or above 1000.",
                    },
                    "kind": {"type": "string", "enum": PERSPECTIVE_KINDS},
                    "vanishing_points": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "x": {"type": "integer"},
                                "y": {"type": "integer"},
                                "edges": {
                                    "type": "array",
                                    "items": {"type": "integer"},
                                    "description": "Flat [x1, y1, x2, y2, ...], 2-3 real edges running toward this point.",
                                },
                            },
                            "required": ["x", "y", "edges"],
                        },
                    },
                },
                "required": ["eye_level_y", "kind", "vanishing_points"],
            },
            "proportions": {
                "type": "object",
                "description": "One unit to measure with, and 2-3 spans to compare. Trace only; the app measures.",
                "properties": {
                    "unit": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "line": {"type": "array", "items": {"type": "integer"}, "description": "[x1, y1, x2, y2]"},
                        },
                        "required": ["label", "line"],
                    },
                    "comparisons": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "line": {"type": "array", "items": {"type": "integer"}, "description": "[x1, y1, x2, y2]"},
                            },
                            "required": ["label", "line"],
                        },
                    },
                },
                "required": ["unit", "comparisons"],
            },
            "prepared_prompts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "enum": question_bank.all_keys()},
                        "focus": {"type": "string", "enum": ["selected", "other"]},
                        "mark_ids": {"type": "array", "items": {"type": "string"}},
                        "spot": {"type": "string", "description": "a spot id from the plan, such as x1, or empty"},
                        "question": {"type": "string"},
                        "options": {"type": "array", "items": {"type": "string"}},
                        # One list per option: the marks that option refers to.
                        "option_mark_ids": {
                            "type": "array",
                            "items": {"type": "array", "items": {"type": "string"}},
                        },
                    },
                    "required": ["key", "focus", "mark_ids", "question", "options", "option_mark_ids"],
                },
            },
            # One per selected shape, when the plan lists any (item 17).
            # Not required: a sketch with nothing selected returns none.
            "mark_meanings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "shape": {"type": "string"},
                        "spot": {"type": "string", "description": "a spot id from the plan, such as x1, or empty"},
                        "question": {"type": "string"},
                        "options": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["shape", "question", "options"],
                },
            },
            # How two or more marked subjects connect (item 17). At most
            # one. Not required: most plans mark a single subject.
            "relationship": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": question_bank.relationship_kinds()},
                    "subjects": {"type": "array", "items": {"type": "string"}},
                    "mark_ids": {"type": "array", "items": {"type": "string"}},
                    "question": {"type": "string"},
                },
                "required": ["kind", "subjects", "mark_ids", "question"],
            },
        },
        "required": [
            "scene_summary", "scene_type", "suggested_title",
            "focal_regions", "perspective", "proportions", "prepared_prompts",
        ],
    }


def resize_if_needed(pil_image: Image.Image, max_dim=MAX_IMAGE_DIMENSION) -> Image.Image:
    w, h = pil_image.size
    if max(w, h) <= max_dim:
        return pil_image
    scale = max_dim / max(w, h)
    return pil_image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)


# ---------- The sketcher's plan ----------

@dataclass
class Plan:
    """What the sketcher decided before analysis, as sent to Gemini."""
    text: str                              # fills $plan in scene_analysis.md
    image: Image.Image | None = None       # Image 2, or None
    focal_points: list[dict] | None = None # stored points and marks, to find
    marks: list[dict] | None = None        # missed focal areas
    # Selected shapes, [{"id": "s1", "mark_ids": [...]}], at most
    # MAX_MARK_MEANING_QUESTIONS: each gets a "What do you see these
    # marks as?" question (item 17).
    selected_shapes: list[dict] | None = None
    # Where the selected marks meet other marks (mark_geometry.spots). A
    # question can point at one; the app shows a reticle there.
    spots: list[dict] | None = None
    # The framed photo's width / height: geometry measures distances in
    # square units (mark_geometry.square_scale).
    aspect: float = 1.0


def _describe_focal_points(focal_points: list[dict]) -> str:
    parts = []
    for i, p in enumerate(focal_points, 1):
        if p.get("x") is None or p.get("y") is None:
            continue
        x, y = round(p["x"]), round(p["y"])
        note = ", adopted from an earlier AI suggestion" if p.get("source") == "adopted" else ""
        parts.append(f"#{i} at ({x}, {y}), {composite.region_name(x, y)}{note}")
    return "; ".join(parts) if parts else "none marked"


def build_plan(sketch, framed_image: Image.Image | None = None) -> Plan:
    """
    The sketcher's focal points and marks, as prompt text plus the planning
    image. Reframing is covered separately by scene_analysis_reframed.md.
    `framed_image` draws the planning image on that photo instead of loading
    sketch.reference_image_url from uploads/ (used by tools/scene_eval.py).
    """
    focal_points = sketch.focal_points or []
    # Erased marks are kept as data, but they are not part of the plan.
    marks = composite.visible_marks(sketch.marks)
    if not focal_points and not marks:
        return Plan(text=render_prompt(PROMPTS / "scene_analysis_no_plan.md"), focal_points=[], marks=[])
    aspect = frame_aspect(sketch, framed_image)
    debug.print_marks("scene_analysis", getattr(sketch, "id", None), sketch.marks, aspect)
    geo = mark_geometry.analyse(marks, aspect)
    selected_shapes = selected_shape_list(geo)
    selected_ids = {f["id"] for f in geo["marks"] if f.get("selected")}
    spot_list = mark_geometry.spots(geo, selected_ids) if selected_ids else []
    text = render_prompt(
        PROMPTS / "scene_analysis_plan.md",
        focal_points=f"- Focal points: {_describe_focal_points(focal_points)}\n" if focal_points else "",
        marks_table=mark_geometry.marks_table(geo) if marks else "none drawn",
        selected_shapes=_describe_selected_shapes(selected_shapes),
        spots=mark_geometry.spots_text(spot_list),
        links=mark_geometry.groups_text(geo) if marks else "none",
    )
    # Image 2 carries each mark's id at its start, so Gemini can tie what
    # it sees to the ids in the prompt. The sketcher never sees ids.
    image = (
        composite.draw_plan(framed_image, focal_points, marks, label_ids=True) if framed_image is not None
        else composite.render_composite(sketch, label_ids=True)
    )
    return Plan(text=text, image=image, focal_points=focal_points, marks=marks,
                selected_shapes=selected_shapes, spots=spot_list, aspect=aspect)


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


def _attach_spot(p: dict, spot_by_id: dict) -> dict:
    """Replaces a spot id with the spot itself ({x, y, mark_ids}), or drops it."""
    sp = spot_by_id.get(p.pop("spot", None) or "")
    if sp:
        p["spot"] = {"x": sp["x"], "y": sp["y"], "mark_ids": sp["mark_ids"]}
    return p


def selected_shape_list(geo: dict) -> list[dict]:
    """
    The shapes that hold a selected mark, in stroke order, each with only
    its selected marks. At most MAX_MARK_MEANING_QUESTIONS.
    """
    selected = {f["id"] for f in geo["marks"] if f.get("selected")}
    shapes = []
    for g in geo["groups"]:
        ids = [i for i in g["mark_ids"] if i in selected]
        if ids:
            shapes.append({"id": g["id"], "mark_ids": ids})
    return shapes[:MAX_MARK_MEANING_QUESTIONS]


def _describe_selected_shapes(shapes: list[dict]) -> str:
    if not shapes:
        return "none selected"
    return "\n".join(f"- {s['id']}: {', '.join(s['mark_ids'])}" for s in shapes)


def plan_fingerprint(sketch) -> str:
    """
    Changes whenever anything the analysis depends on changes (other than
    style, which the router compares on its own). Stored with the cached
    result so a new focal point, mark or framing re-runs the call.
    Adopted points are left out: they come from this same analysis (a
    "yes" to "There is the ... here"), so adopting one must not throw
    the analysis away.
    """
    payload = {
        "version": ANALYSIS_VERSION,
        "reference": sketch.reference_image_url,
        "crop": sketch.crop_transform,
        "focal_points": [
            (p.get("x"), p.get("y")) for p in (sketch.focal_points or []) if p.get("source") != "adopted"
        ],
        # Prompted marks ("Yes, add it") come from this same analysis, so
        # adding one must not throw the analysis away (item 17).
        "marks": [m for m in (sketch.marks or []) if m.get("source") != "prompted"],
    }
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def build_prompt(style: str, crop_transform: dict | None = None, plan: Plan | None = None) -> str:
    plan = plan or Plan(text=render_prompt(PROMPTS / "scene_analysis_no_plan.md"))
    prompt = render_prompt(
        PROMPTS / "scene_analysis.md",
        style=style,
        plan=plan.text,
        prompt_guide=question_bank.render_guide(),
        relationship_kinds=question_bank.render_relationship_kinds(),
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


# ---------- Perspective checks ----------

def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _segments(flat) -> list[tuple[float, float, float, float]]:
    if not isinstance(flat, list):
        return []
    nums = [v for v in flat if isinstance(v, (int, float))]
    return [tuple(_clamp(v, 0, 1000) for v in nums[i:i + 4]) for i in range(0, len(nums) - 3, 4)]


def _angle_to_point(seg, point) -> float:
    """Degrees between a segment's line and the direction from its midpoint to `point`."""
    x1, y1, x2, y2 = seg
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    a = math.atan2(y2 - y1, x2 - x1)
    b = math.atan2(point[1] - my, point[0] - mx)
    d = abs((a - b + math.pi / 2) % math.pi - math.pi / 2)  # undirected lines
    return math.degrees(d)


def _fit_point(segs) -> tuple[float, float] | None:
    """Least-squares point closest to every segment's line. None if they're near parallel."""
    a11 = a12 = a22 = b1 = b2 = 0.0
    for x1, y1, x2, y2 in segs:
        length = math.hypot(x2 - x1, y2 - y1)
        if length < 1e-6:
            continue
        nx, ny = -(y2 - y1) / length, (x2 - x1) / length
        a11 += nx * nx
        a12 += nx * ny
        a22 += ny * ny
        c = nx * x1 + ny * y1
        b1 += nx * c
        b2 += ny * c
    det = a11 * a22 - a12 * a12
    if abs(det) < 1e-3:
        return None
    return ((b1 * a22 - b2 * a12) / det, (a11 * b2 - a12 * b1) / det)


def _edge_tilt(segs) -> float:
    """Mean angle of the segments from horizontal, in degrees."""
    tilts = []
    for x1, y1, x2, y2 in segs:
        t = abs(math.degrees(math.atan2(y2 - y1, x2 - x1))) % 180
        tilts.append(min(t, 180 - t))
    return sum(tilts) / len(tilts) if tilts else 0.0


def _best_point(segs, guess) -> tuple[tuple[float, float], list]:
    """
    The vanishing point that the most edges run toward, and those edges.
    Candidates: where all edges meet, where each pair meets, then
    Gemini's own guess, in that order of preference on a tie. With two or
    more agreeing edges, the point is refit to just those edges.
    """
    candidates = []
    if len(segs) >= 2:
        candidates.append(_fit_point(segs))
        if len(segs) > 2:
            candidates += [_fit_point(pair) for pair in itertools.combinations(segs, 2)]
    candidates.append(guess)
    best_point, best_segs = guess, []
    for c in candidates:
        if c is None or not all(VP_MIN <= v <= VP_MAX for v in c):
            continue
        agree = [s for s in segs if _angle_to_point(s, c) <= EDGE_ANGLE_TOLERANCE]
        if len(agree) > len(best_segs):
            best_point, best_segs = c, agree
    if len(best_segs) >= 2:
        refit = _fit_point(best_segs)
        if refit and all(VP_MIN <= v <= VP_MAX for v in refit):
            best_point = refit
    return best_point, best_segs


def clean_perspective(raw) -> dict | None:
    """
    Checks Gemini's perspective against its own traced edges:
      - The vanishing point moves to where the most traced edges actually
        meet (_best_point). Traced edges are more reliable than a guessed
        point. An edge that misses it is dropped.
      - A lone edge is kept only if it runs toward Gemini's point.
      - A vanishing point with no edge left is dropped.
      - Eye level is moved to the height of the vanishing points on it
        (not a vertical one), since those points sit on eye level by
        definition.
    Returns None when there is nothing usable.
    """
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind") if raw.get("kind") in PERSPECTIVE_KINDS else "none"
    eye = raw.get("eye_level_y")
    eye = _clamp(eye, OFF_FRAME_MIN, OFF_FRAME_MAX) if isinstance(eye, (int, float)) else None

    raw_vps = raw.get("vanishing_points") if kind != "none" else None
    if not isinstance(raw_vps, list):
        raw_vps = []
    vps = []
    for vp in raw_vps[:MAX_VANISHING_POINTS]:
        if not isinstance(vp, dict) or not all(isinstance(vp.get(k), (int, float)) for k in ("x", "y")):
            continue
        guess = (vp["x"], vp["y"])
        segs = _segments(vp.get("edges"))[:MAX_EDGES_PER_VP]
        point, segs = _best_point(segs, guess)
        if not segs:
            continue
        vps.append({
            "x": round(_clamp(point[0], VP_MIN, VP_MAX)),
            "y": round(_clamp(point[1], VP_MIN, VP_MAX)),
            "edges": [round(v) for s in segs for v in s],
            "_tilt": _edge_tilt(segs),
        })

    on_eye_level = [v["y"] for v in vps if v["_tilt"] < VERTICAL_EDGE_ANGLE]
    if on_eye_level:
        eye = round(sum(on_eye_level) / len(on_eye_level))
    for v in vps:
        del v["_tilt"]

    if not vps:
        kind = "none"
    if eye is None and not vps:
        return None
    return {"eye_level_y": None if eye is None else round(eye), "kind": kind, "vanishing_points": vps}


# ---------- Proportions ----------

MAX_COMPARISONS = 3
# A traced span shorter than this share of the photo's longer side is too
# small to measure against (or a mis-trace).
MIN_SPAN_FRACTION = 0.03


# How far (degrees) a span may lean from the unit's direction and still
# count as measuring the same direction. Spans keep their traced lean, the
# way a sketcher follows a tower that leans in the photo.
MAX_LEAN_DEGREES = 30.0


def _span(raw, w: int, h: int, axis: str | None = None) -> dict | None:
    """
    A {label, line} span, clamped to the frame, kept as traced (following
    the object's own lean). Its axis is "vertical" (a height) when it runs
    within MAX_LEAN_DEGREES of straight up and down, "horizontal" (a width)
    within that of straight across. A span that fits neither, or doesn't
    match `axis`, returns None, so every guide measures one direction.
    `_len` is its length in pixels of the analysed photo.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("label"), str):
        return None
    line = raw.get("line")
    if not isinstance(line, list) or len(line) < 4 or not all(isinstance(v, (int, float)) for v in line[:4]):
        return None
    x1, y1, x2, y2 = (round(_clamp(v, 0, 1000)) for v in line[:4])
    # 0-1000 is a share of width in x and of height in y, so compare in pixels.
    dx_px = abs(x2 - x1) * w / 1000
    dy_px = abs(y2 - y1) * h / 1000
    length = math.hypot(dx_px, dy_px)
    if length < MIN_SPAN_FRACTION * max(w, h):
        return None
    lean_from_vertical = math.degrees(math.atan2(dx_px, dy_px))
    if lean_from_vertical <= MAX_LEAN_DEGREES:
        own_axis = "vertical"
    elif lean_from_vertical >= 90 - MAX_LEAN_DEGREES:
        own_axis = "horizontal"
    else:
        return None  # a diagonal, neither a height nor a width
    if axis is not None and own_axis != axis:
        return None
    # Top-to-bottom (or left-to-right), so ticks step the same way on every span.
    if (own_axis == "vertical" and y2 < y1) or (own_axis == "horizontal" and x2 < x1):
        x1, y1, x2, y2 = x2, y2, x1, y1
    return {"label": raw["label"].strip(), "line": [x1, y1, x2, y2], "_len": length, "_axis": own_axis}


def _round_ratio(r: float) -> float:
    """How a sketcher would say it: quarters below 1 unit, halves above."""
    step = 0.25 if r < 1 else 0.5
    return max(0.25, round(r / step) * step)


# A span is turned to point at a vanishing point only if its traced
# direction is already within this many degrees of it.
MAX_ALIGN_DEGREES = 30.0


def _perspective_directions(perspective: dict | None) -> tuple[tuple | None, list[tuple]]:
    """
    (vertical vanishing point, [horizontal vanishing points]) from a checked
    perspective, as (x, y) in 0-1000. A vanishing point whose edges run
    mostly up and down is the vertical one (three-point perspective).
    """
    if not perspective:
        return None, []
    vertical, horizontal = None, []
    for vp in perspective.get("vanishing_points") or []:
        edges = vp.get("edges") or []
        segs = [tuple(edges[i:i + 4]) for i in range(0, len(edges) - 3, 4)]
        point = (vp["x"], vp["y"])
        if segs and _edge_tilt(segs) >= VERTICAL_EDGE_ANGLE:
            vertical = vertical or point
        else:
            horizontal.append(point)
    return vertical, horizontal


def _align_span(span: dict, point: tuple, w: int, h: int) -> bool:
    """
    Turns a span about its midpoint to point at `point`, keeping its length,
    when its traced direction is already within MAX_ALIGN_DEGREES of it.
    Works in pixels, then back to 0-1000. Returns True if it turned.
    """
    x1, y1, x2, y2 = span["line"]
    sx, sy = w / 1000, h / 1000
    mx, my = (x1 + x2) / 2 * sx, (y1 + y2) / 2 * sy
    px, py = point[0] * sx, point[1] * sy
    tx, ty = (x2 - x1) * sx, (y2 - y1) * sy
    dx, dy = px - mx, py - my
    dist = math.hypot(dx, dy)
    if dist < 1e-6:
        return False
    # Angle between the traced line and the direction to the point (undirected).
    a = math.atan2(ty, tx)
    b = math.atan2(dy, dx)
    diff = abs((a - b + math.pi / 2) % math.pi - math.pi / 2)
    if math.degrees(diff) > MAX_ALIGN_DEGREES:
        return False
    ux, uy = dx / dist, dy / dist
    half = span["_len"] / 2
    ax, ay = mx - ux * half, my - uy * half
    bx, by = mx + ux * half, my + uy * half
    line = [round(_clamp(v, 0, 1000)) for v in (ax / sx, ay / sy, bx / sx, by / sy)]
    # Keep top-to-bottom (or left-to-right) order.
    if (span["_axis"] == "vertical" and line[3] < line[1]) or (span["_axis"] == "horizontal" and line[2] < line[0]):
        line = [line[2], line[3], line[0], line[1]]
    span["line"] = line
    return True


def _align_to_perspective(span: dict, perspective: dict | None, w: int, h: int) -> None:
    """
    Gives a span the tilt the photo's perspective implies, instead of the
    tilt Gemini guessed for it: a height points at the vertical vanishing
    point (upright edges converge when the camera looks up or down), a
    width at whichever horizontal vanishing point it already runs toward.
    With no matching vanishing point, the traced tilt stays.
    """
    vertical, horizontal = _perspective_directions(perspective)
    if span["_axis"] == "vertical":
        if vertical is not None:
            _align_span(span, vertical, w, h)
        return
    for point in horizontal:
        if _align_span(span, point, w, h):
            return


def clean_proportions(raw, w: int, h: int, perspective: dict | None = None) -> dict | None:
    """
    Measures in one direction only, the way a pencil held at arm's length
    measures: the unit sets the axis (a height or a width), and a comparison
    along the other axis, or a diagonal, is dropped. Each span's tilt then
    comes from the photo's perspective (_align_to_perspective), so a tower
    near the middle stays nearly upright and one further out leans more. Each ratio is the span's length against the unit's, in pixels of
    the analysed photo. Gemini only traces; every ratio comes from
    here. Labels are kept for the backend and the critique, not drawn.
    None when there's no usable unit or nothing left to compare.
    """
    if not isinstance(raw, dict):
        return None
    unit = _span(raw.get("unit"), w, h)
    if unit is None:
        return None
    axis = unit["_axis"]
    _align_to_perspective(unit, perspective, w, h)
    comparisons = []
    for c in (raw.get("comparisons") or [])[:MAX_COMPARISONS]:
        span = _span(c, w, h, axis)
        if span is not None:
            _align_to_perspective(span, perspective, w, h)
            comparisons.append({"label": span["label"], "line": span["line"],
                                "ratio": _round_ratio(span["_len"] / unit["_len"])})
    if not comparisons:
        return None
    return {
        "axis": axis,
        "unit": {"label": unit["label"], "line": unit["line"], "ratio": 1.0},
        "comparisons": comparisons,
    }


# ---------- Missed focal areas ----------

def build_focal_suggestions(
    regions: list[dict],
    focal_points: list[dict] | None,
    marks: list[dict] | None = None,
    aspect: float | None = 1.0,
) -> list[dict]:
    """
    The focal_regions the sketcher has not noticed, strongest first, capped
    at MAX_FOCAL_SUGGESTIONS. Each becomes a "There is the ... here" guided
    question with a reticle on the photo. An area counts as noticed when a
    focal point sits on it or a mark runs through it. That is decided by
    geometry (focal_pairing.py), not by Gemini's own sketcher_marked flag:
    the points and marks are exact, Gemini's read is not.
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


def with_suggestion_prompts(result: dict, focal_points: list[dict] | None, marks: list[dict] | None = None) -> dict:
    """
    Puts the questions in the order of design doc items 15 and 17:
      1. selected: how the marked subjects connect (relationship), "What
         do you see these marks as?" (mark_meaning), then bank questions
         about the selected marks
      2. unseen: one "There is the ... here" question per missed focal area. An
         area the sketcher already adopted (a stored point with that
         region_ref) is skipped, so reopening the guidance on a cached
         result doesn't ask again.
      3. other: every other bank question
    """
    adopted = {
        p.get("region_ref") for p in (focal_points or [])
        if p.get("source") == "adopted" and p.get("region_ref") is not None
    } | {
        m.get("adopted_region") for m in (marks or [])
        if m.get("adopted_region") is not None and not m.get("erased")
    }
    base = [p for p in result.get("prepared_prompts", []) if not p.get("suggestion")]
    first_keys = ("relationship", "mark_meaning")
    meaning = [p for k in first_keys for p in base if p.get("key") == k]
    selected = [p for p in base if p.get("key") not in first_keys and p.get("focus") == "selected"]
    other = [p for p in base if p.get("key") not in first_keys and p.get("focus") != "selected"]
    suggestion_prompts = [
        {**question_bank.focal_suggestion_prompt(sg["label"], sg.get("reason")), "suggestion": sg, "focus": "unseen"}
        for sg in result.get("focal_suggestions", [])
        if sg["region_ref"] not in adopted
    ]
    return {**result, "prepared_prompts": meaning + selected + suggestion_prompts + other}


def refresh_suggestions(
    result: dict,
    focal_points: list[dict] | None,
    marks: list[dict] | None,
    style: str | None = None,
) -> dict:
    """
    Recomputes the missed focal areas and their questions from a result's
    own focal_regions. Used when the router reuses a cached result, so the
    current rule and the sketch's current points and marks always apply.
    """
    try:
        suggestions = build_focal_suggestions(
            result.get("focal_regions") or [], focal_points, marks, result.get("frame_aspect", 1.0)
        )
    except Exception:
        suggestions = result.get("focal_suggestions", [])  # an old or malformed cache
    refreshed = with_suggestion_prompts({**result, "focal_suggestions": suggestions}, focal_points, marks)
    # Also re-matches overlays, so a question bank edit applies to cached results.
    refreshed["prepared_prompts"] = question_bank.attach_option_actions(
        refreshed["prepared_prompts"], style, question_bank.overlay_data(refreshed)
    )
    refreshed["grid"] = question_bank.grid_action(style)
    return refreshed


def _option_mark_ids(p: dict, visible_ids: set[str]) -> list[list[str]]:
    """
    One list of visible mark ids per option, in order, each mark under at
    most one option (the first that names it), so a tap on the photo picks
    one answer. [] when no option names a mark, or the lists don't line up
    with the options.
    """
    raw = p.get("option_mark_ids") or []
    options = p.get("options") or []
    if len(raw) != len(options):
        return []
    taken, out = set(), []
    for ids in raw:
        keep = [i for i in (ids or []) if isinstance(i, str) and i in visible_ids and i not in taken]
        taken.update(keep)
        out.append(keep)
    return out if any(out) else []


# ---------- Relationship between marked subjects ----------

def _clean_relationship(r, visible_ids: set[str], selected_ids: set[str]) -> dict | None:
    """
    Gemini's relationship as a guided question, or None when it is missing
    or unusable: an unknown kind, fewer than two subjects, no visible marks
    on them, or a missing question.
    """
    if not isinstance(r, dict):
        return None
    kind = r.get("kind")
    subjects = [s for s in (r.get("subjects") or []) if isinstance(s, str) and s.strip()][:3]
    mark_ids = [i for i in (r.get("mark_ids") or []) if i in visible_ids]
    question = (r.get("question") or "").strip()
    if kind not in question_bank.relationship_kinds() or len(subjects) < 2 or not mark_ids \
            or not question:
        if DEBUG:
            print(f"[scene_analysis] relationship dropped: {json.dumps(r)}")
        return None
    focus = "selected" if set(mark_ids) & selected_ids else "other"
    return question_bank.relationship_prompt(question, kind, subjects, mark_ids, focus)


# ---------- The call ----------

def analyze(
    pil_image: Image.Image,
    style: str,
    crop_transform: dict | None = None,
    plan: Plan | None = None,
) -> tuple[dict, str]:
    """
    Call Gemini on the (already resized) reference photo, plus the planning
    image when there is one, and return (cleaned result, raw Gemini text).
    Raises GeminiQuotaExceededError unchanged for the router to turn into a 429.
    """
    images = [pil_image] + ([plan.image] if plan and plan.image is not None else [])
    result, raw_gemini_text = call_gemini_json_with_raw(
        build_prompt(style, crop_transform, plan), response_schema(), images
    )
    if result.get("mixed_dominant_region") == "null":
        result["mixed_dominant_region"] = None

    # A JSON Schema enum can't be scoped to "only the keys valid for
    # whichever scene_type ends up in this same response", so re-check that
    # scoping here, and drop repeats.
    allowed_keys = set(question_bank.eligible_keys(result["scene_type"]))
    visible_ids = {mark_geometry.mark_id(m, i) for i, m in enumerate(mark_geometry.visible_marks(plan.marks if plan else []))}
    selected_ids = {i for s in (plan.selected_shapes or []) for i in s["mark_ids"]} if plan else set()
    spot_by_id = {sp["id"]: sp for sp in (plan.spots or [])} if plan else {}
    seen, prompts = set(), []
    for p in result.get("prepared_prompts", []):
        if p.get("key") in allowed_keys and p["key"] not in seen:
            seen.add(p["key"])
            # Only marks that exist and are visible. "selected" needs at
            # least one selected mark, or the question is "other".
            p["mark_ids"] = [i for i in (p.get("mark_ids") or []) if i in visible_ids]
            p["focus"] = "selected" if p.get("focus") == "selected" and set(p["mark_ids"]) & selected_ids else "other"
            p["option_mark_ids"] = _option_mark_ids(p, visible_ids)
            _attach_spot(p, spot_by_id)
            prompts.append(p)

    # "What do you see these marks as?", one per selected shape, in the
    # order the plan listed them. Exactly two options from Gemini; the
    # third, "Something else", comes from the question bank.
    order = [s["id"] for s in (plan.selected_shapes or [])] if plan else []
    shapes = {s["id"]: s for s in (plan.selected_shapes or [])} if plan else {}
    by_shape = {}
    for m in result.pop("mark_meanings", None) or []:
        shape = shapes.get(m.get("shape"))
        opts = [o for o in (m.get("options") or []) if isinstance(o, str) and o.strip()][:2]
        if shape is None or m["shape"] in by_shape or len(opts) < 2 or not (m.get("question") or "").strip():
            continue
        by_shape[m["shape"]] = _attach_spot(
            {**question_bank.mark_meaning_prompt(m["question"], opts, shape["mark_ids"]), "spot": m.get("spot")},
            spot_by_id,
        )
    # How the marked subjects connect: at most one, asked first. A selected
    # shape whose marks the relationship covers gets no mark_meaning, so
    # the sketcher answers one question instead of two about the same marks.
    relationship = _clean_relationship(result.pop("relationship", None), visible_ids, selected_ids)
    if relationship:
        covered = set(relationship["mark_ids"])
        by_shape = {k: v for k, v in by_shape.items() if not covered & set(shapes[k]["mark_ids"])}
    meanings = [by_shape[s] for s in order if s in by_shape]
    result["prepared_prompts"] = ([relationship] if relationship else []) + meanings + prompts

    # focal_regions: cap at 3 and drop malformed contours. schemas.py's
    # FocalRegion needs at least 3 (x, y) points; dropping bad ones here
    # avoids a 500 on response serialization.
    cleaned_regions = []
    for r in result.get("focal_regions", [])[:3]:
        pts = r.get("contour_points")
        if not isinstance(pts, list) or len(pts) < 6 or len(pts) % 2 != 0:
            continue
        pts = pts[:28]  # 14 points max
        r["contour_points"] = [max(0, min(1000, p)) for p in pts]
        # The marks' shape (item 17): an id and [[x, y], ...].
        r["id"] = f"a{len(cleaned_regions) + 1}"
        r["points"] = [[r["contour_points"][k], r["contour_points"][k + 1]] for k in range(0, len(r["contour_points"]), 2)]
        cleaned_regions.append(r)
    result["focal_regions"] = cleaned_regions
    # Stored with the result, so a cached result's geometry checks
    # (refresh_suggestions) measure in the same square units.
    result["frame_aspect"] = round(pil_image.size[0] / pil_image.size[1], 4) if pil_image.size[1] else 1.0

    plan_points = plan.focal_points if plan else []
    plan_marks = plan.marks if plan else []
    result["focal_suggestions"] = build_focal_suggestions(cleaned_regions, plan_points, plan_marks, result["frame_aspect"])
    result = with_suggestion_prompts(result, plan_points, plan_marks)
    result["grid"] = question_bank.grid_action(style)

    raw_perspective = result.get("perspective")
    result["perspective"] = clean_perspective(raw_perspective)
    raw_proportions = result.get("proportions")
    # After perspective: each span's tilt comes from the vanishing points.
    result["proportions"] = clean_proportions(raw_proportions, *pil_image.size, result["perspective"])

    # After perspective and proportions: a question whose overlay has no
    # data is dropped here.
    result["prepared_prompts"] = question_bank.attach_option_actions(
        result["prepared_prompts"], style, question_bank.overlay_data(result)
    )

    # Readable summary of what was decided, separate from gemini_service.py's
    # raw prompt/schema/response dump.
    if not DEBUG:
        return result, raw_gemini_text
    print("\n--- Scene Analysis decision ---")
    print(f"style: {style}  |  scene_type: {result['scene_type']}  |  plan image sent: {len(images) > 1}")
    for r in result["focal_regions"]:
        print(f"focal_region: {r['label']!r}  gemini says marked={r.get('sketcher_marked')}  reason={r.get('reason')!r}")
    print(f"missed focal areas (by geometry, points and marks): {[sg['label'] for sg in result['focal_suggestions']]}")
    print(f"perspective (raw):     {json.dumps(raw_perspective)}")
    print(f"perspective (checked): {json.dumps(result['perspective'])}")
    print(f"proportions (raw):     {json.dumps(raw_proportions)}")
    print(f"proportions (measured): {json.dumps(result['proportions'])}")
    rel = next((p["relationship"] for p in result["prepared_prompts"] if p.get("key") == "relationship"), None)
    print(f"relationship: {json.dumps(rel) if rel else 'none'}")
    print("prepared_prompts delivered to sketcher:")
    for p in result["prepared_prompts"]:
        print(f"  [{p['key']} / {p.get('focus')} / marks {p.get('mark_ids') or []}] {p['question']}")
        print(f"      options: {p['options']}  overlays: {p.get('option_actions')}")
    print("--- end Scene Analysis decision ---\n")

    return result, raw_gemini_text
