"""
Converts every sketch's focal points into marks (design doc, Section 11,
item 17: marks are the one plan). Run it yourself, from backend/, with your
.env (it reads DATABASE_URL the same way the app does):

    python -m tools.convert_focal_points            # dry run: prints what would change
    python -m tools.convert_focal_points --apply    # writes the changes

Safe to run more than once. It only touches sketches that still have focal
points, so a second run after item 17 ships picks up any stragglers.

Each focal point becomes one mark:
  - a small closed ring around the point, the size of the old reticle
    (RING_RADIUS frame units, drawn round on screen using the photo's own
    width and height), in the default mark colour and 1 mm size
  - selected: True for the sketcher's own points. A focal point was their
    area of interest, which is what a selected mark means now. Adopted
    points stay unselected, like a "Yes, add it" mark today.
  - source: "own" for the sketcher's own points, "prompted" for points
    adopted from an "AI also noticed" question (evidence, item 15)
  - from_focal_point: the original point, kept whole, so nothing is lost
    and the conversion can be undone from the marks alone

Order matters (the list order is the stroke order). The sketcher placed
their own points before drawing marks, so own rings go first. Adopted
points were added during guidance, after the marks, so they go last.
New ids continue after the sketch's highest mN.

After converting, focal_points is set to null. The marks change, so the
next guidance run on that sketch re-analyses (one Gemini call).
"""
import argparse
import math
import re
from pathlib import Path

from PIL import Image

RING_RADIUS = 30        # frame units, like the old reticle's half width
RING_POINTS = 16
MARK_COLOR = "#fde68a"  # --mark-color in index.css
MARK_WIDTH = 6.5        # frame units; what a 1 mm line saves as on a typical screen
MARK_SIZE_MM = 1.0


def photo_aspect(sketch) -> float:
    """Width / height of the framed photo, or 1 when the file isn't on disk."""
    from app.core.paths import UPLOAD_DIR
    url = sketch.reference_image_url
    if not url:
        return 1.0
    path = UPLOAD_DIR / Path(url).name
    try:
        with Image.open(path) as im:
            w, h = im.size
        return w / h if h else 1.0
    except OSError:
        return 1.0


def ring(x: float, y: float, aspect: float) -> list[list[float]]:
    """A closed ring that looks round on screen. Frame units stretch with
    the photo, so the y radius is scaled by the photo's aspect."""
    rx, ry = RING_RADIUS, RING_RADIUS * aspect
    pts = []
    for i in range(RING_POINTS + 1):  # +1 closes the ring
        t = 2 * math.pi * i / RING_POINTS
        pts.append([
            round(min(1000, max(0, x + rx * math.cos(t))), 1),
            round(min(1000, max(0, y + ry * math.sin(t))), 1),
        ])
    return pts


def next_id(marks: list[dict]) -> int:
    n = 0
    for m in marks:
        k = re.match(r"^m(\d+)$", str(m.get("id") or ""))
        if k:
            n = max(n, int(k.group(1)))
    return n + 1


def convert(sketch) -> list[dict] | None:
    """The sketch's new marks list, or None when there is nothing to convert."""
    points = [p for p in (sketch.focal_points or []) if p.get("x") is not None and p.get("y") is not None]
    if not points:
        return None
    marks = [dict(m) for m in (sketch.marks or [])]
    # Marks saved before ids existed get m1, m2, ... in their current order.
    for i, m in enumerate(marks):
        m.setdefault("id", f"m{i + 1}")
    n = next_id(marks)
    aspect = photo_aspect(sketch)

    own, adopted = [], []
    for p in points:
        prompted = p.get("source") == "adopted"
        mark = {
            "id": f"m{n}",
            "source": "prompted" if prompted else "own",
            "color": MARK_COLOR,
            "width": MARK_WIDTH,
            "size_mm": MARK_SIZE_MM,
            "points": ring(float(p["x"]), float(p["y"]), aspect),
            # Selected means the sketcher's own focus, so only their own
            # points. An adopted point stays a prompted, unselected mark.
            "selected": not prompted,
            "from_focal_point": dict(p),
        }
        n += 1
        (adopted if prompted else own).append(mark)
    return own + marks + adopted


def main():
    ap = argparse.ArgumentParser(description="Convert focal points into marks.")
    ap.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    args = ap.parse_args()

    from app.core.database import SessionLocal
    from app.core.models import Sketch

    db = SessionLocal()
    try:
        sketches = db.query(Sketch).filter(Sketch.focal_points.isnot(None)).all()
        changed = 0
        for s in sketches:
            new_marks = convert(s)
            if new_marks is None:
                if args.apply:
                    s.focal_points = None  # an empty list: nothing to keep
                continue
            added = [m for m in new_marks if m.get("from_focal_point")]
            kinds = ", ".join(f"{m['id']} ({m['source']})" for m in added)
            print(f"{s.id}  {s.title or 'Untitled'}: {len(added)} focal point(s) -> {kinds}")
            changed += 1
            if args.apply:
                # New lists, so SQLAlchemy sees the JSON columns change.
                s.marks = new_marks
                s.focal_points = None
        if args.apply:
            db.commit()
            print(f"\nConverted {changed} sketch(es).")
        else:
            print(f"\nDry run: {changed} sketch(es) would change. Run with --apply to write.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
