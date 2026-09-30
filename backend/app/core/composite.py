"""
Coaching composite: the sketcher's framed reference photo with their own
focal points and planning marks drawn on top, for the Help Quest, Critique
Agent and scene analysis calls.

Scene analysis sends it only as a second image, after the clean
reference_image_url, and its prompt reads every scene fact and coordinate
from the clean photo, so the sketcher's own lines are never mistaken for
edges in the scene (design doc, Section 11, item 10). The composite
is rebuilt from sketches.focal_points + sketches.marks each time it's
needed rather than stored, so it can't drift out of sync with them.

Coordinates: focal_points and marks are both 0-1000 in the frame that
reference_image_url shows (see Marks.jsx / FocalSpotPicker.jsx). Drawing
matches the frontend: red square reticles (FocalSpotPicker's Reticle) and
round-capped polylines whose width is in "px on a 1000px-wide frame".
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from config import COACHING_MAX_DIMENSION, MAX_IMAGE_DIMENSION, MAX_MARKS_FOR_AI
from app.core.paths import UPLOAD_DIR
from app.core.mark_geometry import visible_marks


FOCAL_COLOR = (255, 7, 58)          # --focal-accent-user
RETICLE_HALF = 30                   # frame units, same as Reticle (60 wide)
RETICLE_REACH = 16                  # cross-hair overhang, frame units

COLOR_NAMES = {
    "#ffffff": "white",
    "#ffd400": "yellow",
    "#00c8ff": "blue",
    "#ff073a": "red",
    "#111111": "black",
}
WIDTH_NAMES = {3: "fine", 6: "medium", 12: "bold"}   # older marks, by frame-unit width
# Marks with size_mm (Marks.jsx line sizes, --mark-size-* in index.css).
SIZE_NAMES = {0.5: "fine", 1.0: "medium", 2.0: "bold"}


def _hex_to_rgb(color: str) -> tuple[int, int, int]:
    c = color.lstrip("#")
    try:
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return (255, 255, 255)


def _load_upload(url: str | None, max_dim: int = MAX_IMAGE_DIMENSION) -> Image.Image | None:
    """Open an /uploads/... image, downsized so its longest side is at most max_dim."""
    if not url:
        return None
    path = UPLOAD_DIR / Path(url).name
    if not path.exists():
        return None
    img = Image.open(path).convert("RGB")
    w, h = img.size
    if max(w, h) > max_dim:
        scale = max_dim / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return img


def was_reframed(sketch) -> bool:
    """True when the sketcher changed the framing (a separate cropped file)."""
    # Older sketches have no original_image_url; there's nothing to compare
    # against, so they count as not reframed.
    return (
        bool(sketch.original_image_url)
        and bool(sketch.reference_image_url)
        and sketch.reference_image_url != sketch.original_image_url
    )


def render_composite(sketch, label_ids: bool = False) -> Image.Image | None:
    """
    The planning image: framed reference photo + focal reticles + planning
    marks. None when the sketcher did no planning at all -- never reframed,
    no focal points, no marks -- since it would just repeat the original
    photo. Also None if the reference photo isn't on disk.
    """
    focal_points = sketch.focal_points or []
    marks = visible_marks(sketch.marks)  # erased marks are data, never drawn
    if not was_reframed(sketch) and not focal_points and not marks:
        return None
    # Coaching-size: Help Quest, the critique and scene analysis's Image 2
    # read composition from it, not exact coordinates.
    img = _load_upload(sketch.reference_image_url, COACHING_MAX_DIMENSION)
    if img is None:
        return None
    return draw_plan(img, focal_points, marks, label_ids=label_ids)


def _label_font(size: int):
    for name in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def _label_marks(img: Image.Image, marks: list[dict]) -> Image.Image:
    """Each mark's id (m1, m2, ...) in a small black tag where the stroke
    started, so Gemini can tie what it sees to the ids in the prompt.
    Scene analysis only; the sketcher never sees ids."""
    from app.core.mark_geometry import mark_id
    d = ImageDraw.Draw(img)
    W, H = img.size
    font = _label_font(max(12, W // 60))
    for i, m in enumerate(marks):
        x, y = m["points"][0]
        x, y = x * W / 1000 + 5, y * H / 1000 - 5
        text = mark_id(m, i)
        box = d.textbbox((x, y), text, font=font)
        d.rectangle((box[0] - 3, box[1] - 2, box[2] + 3, box[3] + 2), fill=(0, 0, 0))
        d.text((x, y), text, fill=(255, 255, 255), font=font)
    return img


def draw_plan(img: Image.Image, focal_points: list[dict], marks: list[dict], label_ids: bool = False) -> Image.Image:
    """
    Draws focal reticles and planning marks onto a copy of `img` (the framed
    photo). Split out of render_composite so tools/scene_eval.py can build
    the same planning image from a photo that isn't in uploads/.
    """
    img = img.convert("RGB")
    marks = visible_marks(marks)
    w, h = img.size
    if max(w, h) > COACHING_MAX_DIMENSION:
        scale = COACHING_MAX_DIMENSION / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    else:
        img = img.copy()
    if not focal_points and not marks:
        return img  # reframed only: the crop itself is the plan

    W, H = img.size
    sx, sy = W / 1000, H / 1000

    # Marks first, so the focal reticles stay readable on top of them.
    draw = ImageDraw.Draw(img)
    for m in marks:
        pts = [(x * sx, y * sy) for x, y in m.get("points", [])]
        if not pts:
            continue
        rgb = _hex_to_rgb(m.get("color", "#ffffff"))
        width = max(1, round(float(m.get("width", 6)) * sx))
        if len(pts) > 1:
            draw.line(pts, fill=rgb, width=width, joint="curve")
        # Round caps (and single-tap dots): PIL lines have square ends.
        r = width / 2
        for (x, y) in (pts[0], pts[-1]):
            draw.ellipse((x - r, y - r, x + r, y + r), fill=rgb)

    # Focal reticles: translucent fill needs an RGBA overlay.
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    half = RETICLE_HALF * sx        # square on screen, like the frontend
    reach = RETICLE_REACH * sx
    line_w = max(2, round(W / 500))
    for p in focal_points:
        if p.get("x") is None or p.get("y") is None:
            continue
        cx, cy = p["x"] * sx, p["y"] * sy
        box = (cx - half, cy - half, cx + half, cy + half)
        od.rectangle(box, fill=FOCAL_COLOR + (102,), outline=FOCAL_COLOR + (255,), width=line_w)
        od.line([(cx - half - reach, cy), (cx + half + reach, cy)], fill=FOCAL_COLOR + (255,), width=line_w)
        od.line([(cx, cy - half - reach), (cx, cy + half + reach)], fill=FOCAL_COLOR + (255,), width=line_w)
    out = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    return _label_marks(out, marks) if label_ids and marks else out


def load_original(sketch, max_dim: int = MAX_IMAGE_DIMENSION) -> Image.Image | None:
    """
    The untouched upload (original_image_url), before any crop, pan or
    zoom. Falls back to reference_image_url for older sketches saved before
    original_image_url existed. None only if neither file is on disk.
    """
    return _load_upload(sketch.original_image_url or sketch.reference_image_url, max_dim)


def region_name(x: float, y: float) -> str:
    """Rule-of-thirds cell for a 0-1000 point, e.g. 'upper-left'."""
    col = "left" if x < 333.3 else ("center" if x < 666.7 else "right")
    row = "upper" if y < 333.3 else ("middle" if y < 666.7 else "lower")
    if row == "middle" and col == "center":
        return "center"
    return f"{row}-{col}"


def describe_focal_points(focal_points: list[dict] | None) -> str:
    """One line per focal point, with where it sits and what it was paired to."""
    if not focal_points:
        return "none marked"
    parts = []
    for i, p in enumerate(focal_points, 1):
        if p.get("x") is None or p.get("y") is None:
            continue
        where = region_name(p["x"], p["y"])
        label = p.get("paired_label")
        source = "adopted from an AI suggestion" if p.get("source") == "adopted" else "the sketcher's own pick"
        parts.append(
            f"#{i} in the {where} third ({source}"
            + (f", on the {label}" if label else "")
            + ")"
        )
    return "; ".join(parts) if parts else "none marked"


def _path_length(pts: list[list[float]]) -> float:
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def _mark_kind(m: dict) -> str:
    """dot, closed shape, straight line or freehand line (simple geometry)."""
    pts = m.get("points") or []
    if len(pts) < 2:
        return "dot"
    length = _path_length(pts)
    chord = math.dist(pts[0], pts[-1])
    if length > 150 and chord < 0.15 * length:
        return "closed shape"
    return "straight line" if chord >= 0.95 * length else "freehand line"


def _describe_mark(m: dict) -> str:
    """One mark in words: its kind and where it sits on the rule-of-thirds grid."""
    pts = m.get("points") or []
    kind = _mark_kind(m)
    if kind == "dot":
        return f"a dot in the {region_name(*pts[0])}"
    if kind == "closed shape":
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return f"a closed shape around the {region_name((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)}"
    return f"a {kind} from the {region_name(*pts[0])} to the {region_name(*pts[-1])}"


def summarize_marks(marks: list[dict] | None) -> str:
    """
    A short summary of the visible marks for the critique and Help Quest,
    which see them on the planning image. Counts by kind, then describes
    only the marks that carry meaning: the selected ones (the sketcher's
    focus) and the prompted ones (added from an AI suggestion, item 17),
    at most MAX_MARKS_FOR_AI. Colour only when the marks use more than
    one. For example: "14 marks: 9 freehand lines, 3 closed shapes, 1
    straight line, 1 dot. Selected: a closed shape around the center; a
    freehand line from the middle-left to the center."
    Scene analysis lists every mark by id instead (mark_geometry.marks_table).
    Erased marks are left out; summarize_revisions covers them.
    """
    marks = visible_marks(marks)
    if not marks:
        return "none drawn"
    kinds: dict[str, int] = {}
    for m in marks:
        k = _mark_kind(m)
        kinds[k] = kinds.get(k, 0) + 1
    plural = {"freehand line": "freehand lines", "straight line": "straight lines",
              "closed shape": "closed shapes", "dot": "dots"}
    counts = ", ".join(f"{n} {plural.get(k, k) if n != 1 else k}" for k, n in
                       sorted(kinds.items(), key=lambda kv: -kv[1]))
    text = f"{len(marks)} mark{'s' if len(marks) != 1 else ''}: {counts}."
    colours = {str(m.get("color", "")).lower() for m in marks}
    if len(colours) > 1:
        names = [COLOR_NAMES.get(c, c) for c in sorted(colours)]
        text += f" Colours: {', '.join(names)}."
    for label, test in (("Selected", lambda m: m.get("selected")),
                        ("Added from an AI suggestion", lambda m: m.get("source") == "prompted")):
        picked = [m for m in marks if test(m)][:MAX_MARKS_FOR_AI]
        if picked:
            text += f" {label}: " + "; ".join(_describe_mark(m) for m in picked) + "."
    return text


def summarize_revisions(marks: list[dict] | None) -> str:
    """
    The sketcher's erased marks, for the critique: how many, and when in
    the planning they were erased. "none" when nothing was erased.
    Revisions are process evidence, never a mistake.
    """
    erased = [m for m in (marks or []) if m.get("erased") and m.get("points")]
    if not erased:
        return "none"
    return f"{len(erased)} mark{'s' if len(erased) != 1 else ''} drawn and then erased while planning"
