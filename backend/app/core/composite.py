"""
Coaching composite: the sketcher's framed reference photo with their own
focal points and planning marks drawn on top, for the Help Quest and
Critique Agent calls.

Scene analysis never uses this -- it keeps reading the clean
reference_image_url, so Gemini's scene facts (scene_type, focal_regions,
perspective_lines) aren't skewed by the sketcher's own lines. The composite
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

from PIL import Image, ImageDraw

from config import COACHING_MAX_DIMENSION, MAX_IMAGE_DIMENSION
from app.core.paths import UPLOAD_DIR


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
WIDTH_NAMES = {3: "fine", 6: "medium", 12: "bold"}


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


def render_composite(sketch) -> Image.Image | None:
    """
    The planning image: framed reference photo + focal reticles + planning
    marks. None when the sketcher did no planning at all -- never reframed,
    no focal points, no marks -- since it would just repeat the original
    photo. Also None if the reference photo isn't on disk.
    """
    focal_points = sketch.focal_points or []
    marks = sketch.marks or []
    if not was_reframed(sketch) and not focal_points and not marks:
        return None
    # Coaching-size: only Help Quest and the critique use this image.
    img = _load_upload(sketch.reference_image_url, COACHING_MAX_DIMENSION)
    if img is None:
        return None
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
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def load_original(sketch, max_dim: int = MAX_IMAGE_DIMENSION) -> Image.Image | None:
    """
    The untouched upload (original_image_url), before any crop, pan or
    zoom. Falls back to reference_image_url for older sketches saved before
    original_image_url existed. None only if neither file is on disk.
    """
    return _load_upload(sketch.original_image_url or sketch.reference_image_url, max_dim)


def _region_name(x: float, y: float) -> str:
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
        where = _region_name(p["x"], p["y"])
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


def summarize_marks(marks: list[dict] | None) -> str:
    """
    Short plain-language summary of the planning marks, e.g.
    "2 marks: a medium yellow closed shape around the lower-left; a fine
    white straight line from upper-left to upper-right". Shape words are
    simple geometry (closed / straight / freehand), not a guess at intent --
    the composite image is what lets Gemini read intent.
    """
    if not marks:
        return "none drawn"
    descs = []
    for m in marks:
        pts = m.get("points") or []
        if not pts:
            continue
        color = COLOR_NAMES.get(str(m.get("color", "")).lower(), str(m.get("color")))
        width = WIDTH_NAMES.get(round(float(m.get("width", 6))), "custom-width")
        if len(pts) == 1:
            descs.append(f"a {color} dot in the {_region_name(*pts[0])}")
            continue
        length = _path_length(pts)
        chord = math.dist(pts[0], pts[-1])
        if length > 150 and chord < 0.15 * length:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            centre = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
            descs.append(f"a {width} {color} closed shape around the {_region_name(*centre)}")
        else:
            kind = "straight line" if chord >= 0.95 * length else "freehand line"
            descs.append(
                f"a {width} {color} {kind} from {_region_name(*pts[0])} to {_region_name(*pts[-1])}"
            )
    if not descs:
        return "none drawn"
    return f"{len(descs)} mark{'s' if len(descs) != 1 else ''}: " + "; ".join(descs)
