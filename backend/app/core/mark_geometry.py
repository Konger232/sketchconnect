"""
Mark geometry: facts about the sketcher's marks that need no AI.

  - which marks are visible (erased marks are kept as data, never drawn)
  - stroke order: the order of visible marks in sketch.marks
  - which marks read as one shape (groups): marks that touch or cross AND
    were drawn one right after the other. A shape is usually drawn in one
    go, so stroke order keeps a long line that touches everything from
    merging the whole drawing into one shape.
  - simple facts per mark: kind, start, end, bounding box

frontend/src/lib/markGeometry.js groups marks the same way, so the Select
tool can pick a whole shape while the sketcher draws. Keep the constants
below in sync with that file.

Coordinates are 0-1000 frame units, the same as Marks.jsx: 0-1000 across
the framed photo's width and 0-1000 down its height, whatever its ratio.
So a unit across and a unit down are only the same size on a 1:1 frame.
Every distance test here (touching, runs along, big marks, guides) runs in
square units instead: pass the frame's aspect (width / height) and the
points are scaled so the frame's long side is 1000 (square_scale). Points
reported back (crossings, boxes) are in frame units again.

Speed: every pair of marks is compared, so each mark is first simplified
(Douglas-Peucker, SIMPLIFY), pairs whose boxes are too far apart to touch
are skipped, and the point-to-line tests run in numpy.
"""
from __future__ import annotations

import math

import numpy as np

# Extra reach (frame units) on top of half of each line's width, so two
# hand-drawn lines that nearly meet still count as touching.
SNAP = 15

# One mark runs along another when this much of it (frame units, or 40% of
# the shorter mark if that is less) lies within reach of the other.
ALONG_MIN = 60

# A straight line longer than this (frame units) is a guide: a horizon, a
# ground line, an alignment line. Guides keep their links but never join a
# group, or one long line would merge every shape it touches.
GUIDE_LENGTH = 500

# A big mark: a frame, a long road edge, an outline around most of the
# scene. Its box spans more than BIG_MARK_LONG (frame units) in one
# direction, or more than BIG_MARK in both. A building half the frame tall
# is not big. Like guides, big marks keep their links but never join a group.
BIG_MARK = 500
BIG_MARK_LONG = 700

# Marks join a group only when drawn this close in stroke order (1 = one
# right after the other). Counted among visible marks.
ORDER_WINDOW = 1

STEP = 5         # marks are resampled to a point every STEP units for "runs along"
SIMPLIFY = 3     # Douglas-Peucker tolerance (frame units) before comparing;
                 # well under the smallest reach (SNAP + line width)


# ---------- marks ----------

def square_scale(aspect: float | None) -> tuple[float, float]:
    """
    (sx, sy) that turn frame units into square units, with the frame's
    long side at 1000. aspect is width / height; 1.0 (or None) is a square
    frame, where nothing changes.
    """
    a = aspect if aspect and aspect > 0 else 1.0
    return (1.0, 1.0 / a) if a >= 1 else (a, 1.0)


def _to_square(mark: dict, sx: float, sy: float) -> dict:
    """A copy of the mark in square units. width is in frame units across
    (Marks.jsx), so it scales with x."""
    return {
        **mark,
        "points": [[p[0] * sx, p[1] * sy] for p in mark["points"]],
        "width": float(mark.get("width", 6)) * sx,
    }


def visible_marks(marks: list[dict] | None) -> list[dict]:
    """Marks that are drawn: not erased, with at least one point."""
    return [m for m in (marks or []) if m.get("points") and not m.get("erased")]


def mark_id(mark: dict, i: int) -> str:
    """The mark's stored id, or m<n> for marks saved before ids existed."""
    return str(mark.get("id") or f"m{i + 1}")


def _length(pts) -> float:
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def kind(mark: dict) -> str:
    """Same rule as composite.summarize_marks: dot, closed shape, straight or freehand line."""
    pts = mark.get("points") or []
    if len(pts) < 2:
        return "dot"
    length = _length(pts)
    chord = math.dist(pts[0], pts[-1])
    if length > 150 and chord < 0.15 * length:
        return "closed shape"
    return "straight line" if chord >= 0.95 * length else "freehand line"


def is_guide(mark: dict) -> bool:
    pts = mark.get("points") or []
    return kind(mark) == "straight line" and _length(pts) >= GUIDE_LENGTH


def is_big(mark: dict) -> bool:
    x0, y0, x1, y1 = _box(mark.get("points") or [[0, 0]])
    w, h = x1 - x0, y1 - y0
    return max(w, h) > BIG_MARK_LONG or min(w, h) > BIG_MARK


# ---------- helpers ----------

def _simplify(pts, tol=SIMPLIFY):
    """Douglas-Peucker, iterative. Keeps the first and last points."""
    pts = [tuple(p) for p in pts]
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        best, best_i = 0.0, None
        for i in range(a + 1, b):
            d = _seg_point_dist(pts[i], pts[a], pts[b])
            if d > best:
                best, best_i = d, i
        if best_i is not None and best > tol:
            keep[best_i] = True
            stack.append((a, best_i))
            stack.append((best_i, b))
    return [p for p, k in zip(pts, keep) if k]


def _resample(pts, step=STEP):
    """Points every `step` units along the mark, so sparse and dense marks compare the same."""
    if len(pts) < 2:
        return [tuple(pts[0])]
    out = [tuple(pts[0])]
    carry = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = math.dist(a, b)
        d = step - carry
        while d <= seg:
            t = d / seg
            out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
            d += step
        carry = seg - (d - step)
    if math.dist(out[-1], pts[-1]) > 0.5:
        out.append(tuple(pts[-1]))
    return out


def _seg_point_dist(p, a, b) -> float:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.dist(p, a)
    t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)))
    return math.dist(p, (ax + t * dx, ay + t * dy))


def _dist_to_line(points, line) -> np.ndarray:
    """Distance from each point to a polyline (numpy): shape (len(points),)."""
    P = np.asarray(points, dtype=float).reshape(-1, 2)
    L = np.asarray(line, dtype=float).reshape(-1, 2)
    if len(L) == 1:
        return np.hypot(*(P - L[0]).T)
    A, B = L[:-1], L[1:]
    D = B - A
    len2 = (D ** 2).sum(axis=1)
    len2[len2 == 0] = 1e-9
    t = ((P[:, None, :] - A[None]) * D[None]).sum(axis=2) / len2[None]
    t = np.clip(t, 0, 1)
    closest = A[None] + t[..., None] * D[None]
    return np.hypot(*(P[:, None, :] - closest).transpose(2, 0, 1)).min(axis=1)


def _longest_run(points, other, reach) -> float:
    near = _dist_to_line(points, other) <= reach
    best = run = 0
    for hit in near:
        run = run + 1 if hit else 0
        best = max(best, run)
    return best * STEP


def _crossings(pa, pb) -> list[tuple[float, float]]:
    """Points where polyline pa crosses polyline pb (numpy), 15 units apart at least."""
    A = np.asarray(pa, dtype=float)
    B = np.asarray(pb, dtype=float)
    a, r = A[:-1], A[1:] - A[:-1]
    c, s = B[:-1], B[1:] - B[:-1]
    den = r[:, None, 0] * s[None, :, 1] - r[:, None, 1] * s[None, :, 0]
    ca = c[None] - a[:, None]
    with np.errstate(divide="ignore", invalid="ignore"):
        t = (ca[..., 0] * s[None, :, 1] - ca[..., 1] * s[None, :, 0]) / den
        u = (ca[..., 0] * r[:, None, 1] - ca[..., 1] * r[:, None, 0]) / den
    hit = (den != 0) & (t >= 0) & (t <= 1) & (u >= 0) & (u <= 1)
    found = []
    for i, j in zip(*np.nonzero(hit)):
        p = (a[i, 0] + t[i, j] * r[i, 0], a[i, 1] + t[i, j] * r[i, 1])
        if all(math.dist(p, q) > 15 for q in found):
            found.append(p)
    return found


def _inside(p, poly) -> bool:
    """Ray-casting point-in-polygon; poly is a closed mark's points."""
    x, y = p
    inside = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def _box(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _boxes_apart(a, b, reach) -> bool:
    return a[2] + reach < b[0] or b[2] + reach < a[0] or a[3] + reach < b[1] or b[3] + reach < a[1]


def _round(p):
    return [round(p[0]), round(p[1])]


# ---------- links and groups ----------

def link(a: dict, b: dict, pa=None, pb=None) -> dict | None:
    """
    How mark b relates to mark a, or None if they don't meet:
      runs_along  a long stretch of one lies on the other
      connects    an end of one meets the other
      crosses     they cross mid-stroke
      contains    b sits inside closed shape a (they don't touch)
      inside      a sits inside closed shape b
    pa, pb: the marks' simplified points, when the caller has them.
    """
    pa = pa or _simplify(a["points"])
    pb = pb or _simplify(b["points"])
    reach = (a.get("width", 6) + b.get("width", 6)) / 2 + SNAP

    if len(pa) > 1 and len(pb) > 1:
        # Longest unbroken stretch of one mark lying on the other. A plain
        # crossing only gives about 2 x reach, so it never counts.
        shared = max(_longest_run(_resample(pb), pa, reach), _longest_run(_resample(pa), pb, reach))
        need = max(min(ALONG_MIN, 0.4 * min(_length(pa), _length(pb))), 4 * reach)
        if shared >= need:
            # Where they cross along the way: a wave drawn along a straight
            # line crosses it again and again (spots()).
            hits = _crossings(pa, pb)
            return {"kind": "runs_along", "length": round(shared), "at": [_round(p) for p in hits]}

    for end in (pb[0], pb[-1]):
        if _dist_to_line([end], pa)[0] <= reach:
            return {"kind": "connects", "at": _round(end)}
    for end in (pa[0], pa[-1]):
        if _dist_to_line([end], pb)[0] <= reach:
            return {"kind": "connects", "at": _round(end)}

    hits = _crossings(pa, pb) if len(pa) > 1 and len(pb) > 1 else []
    if hits:
        return {"kind": "crosses", "at": [_round(p) for p in hits]}

    if kind(a) == "closed shape" and all(_inside(p, pa) for p in pb):
        return {"kind": "contains"}
    if kind(b) == "closed shape" and all(_inside(p, pb) for p in pa):
        return {"kind": "inside"}
    return None


def analyse(marks: list[dict] | None, aspect: float | None = 1.0) -> dict:
    """
    aspect: the framed photo's width / height. Distances are measured in
    square units (square_scale); everything returned is in frame units.

    For the visible marks, in stroke order: per-mark facts, every pairwise
    link, and groups. Two marks read as one shape when they run along,
    connect or cross (not contains) AND were drawn within ORDER_WINDOW
    strokes of each other. Guides (long straight lines) and big marks
    (BIG_MARK) stay in a group of their own. Every link is still listed.
    """
    frame_marks = visible_marks(marks)
    ids = [mark_id(m, i) for i, m in enumerate(frame_marks)]
    sx, sy = square_scale(aspect)
    marks = [_to_square(m, sx, sy) for m in frame_marks]  # square units from here

    def to_frame(p):
        return [round(p[0] / sx), round(p[1] / sy)]

    simple = [_simplify(m["points"]) for m in marks]
    boxes = [_box(m["points"]) for m in marks]
    guides = [is_guide(m) or is_big(m) for m in marks]  # never join a group

    facts = []
    for i, m in enumerate(marks):
        pts = frame_marks[i]["points"]
        frame_box = _box(pts)
        facts.append({
            "id": ids[i],
            "order": i + 1,
            "kind": kind(m),
            "guide": is_guide(m),
            "big": is_big(m),
            "selected": bool(m.get("selected")),
            "prompted": m.get("source") == "prompted",
            "color": m.get("color"),
            "size_mm": m.get("size_mm"),
            "start": _round(pts[0]),
            "end": _round(pts[-1]),
            "box": [round(v) for v in frame_box],
            "points": len(pts),
            "started_ms": m.get("started_ms"),
            "duration_ms": m.get("duration_ms"),
        })

    links = []
    parent = list(range(len(marks)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(marks)):
        for j in range(i + 1, len(marks)):
            reach = (marks[i].get("width", 6) + marks[j].get("width", 6)) / 2 + SNAP
            if _boxes_apart(boxes[i], boxes[j], reach):
                continue
            ln = link(marks[i], marks[j], simple[i], simple[j])
            if not ln:
                continue
            at = ln.get("at")
            if at and isinstance(at[0], list):
                ln["at"] = [to_frame(q) for q in at]
            elif at:
                ln["at"] = to_frame(at)
            links.append({"a": ids[i], "b": ids[j], **ln})
            joins = ln["kind"] in ("runs_along", "connects", "crosses") and j - i <= ORDER_WINDOW
            if joins and not guides[i] and not guides[j]:
                parent[root(j)] = root(i)

    by_root: dict[int, list[int]] = {}
    for i in range(len(marks)):
        by_root.setdefault(root(i), []).append(i)
    groups = [
        {"id": f"s{n}", "mark_ids": [ids[i] for i in members]}
        for n, members in enumerate(sorted(by_root.values(), key=lambda g: g[0]), 1)
    ]
    return {"marks": facts, "links": links, "groups": groups, "aspect": aspect or 1.0}


# ---------- points against marks ----------

def distance_to_marks(point, marks: list[dict] | None, aspect: float | None = 1.0) -> float:
    """
    How far a frame point (0-1000) is from the nearest visible mark, in
    square units: 0 when it sits inside a shape the mark outlines. A large
    number when there are no marks. Used to tell whether an area the AI
    points at is one no mark sits on (marks_analysis, the unseen question).
    An outline is often left open, like a U around a tower, so any curved
    mark longer than 150 units is closed end to end for the inside test.
    """
    sx, sy = square_scale(aspect)
    p = (point[0] * sx, point[1] * sy)
    best = float("inf")
    for m in visible_marks(marks):
        pts = [(q[0] * sx, q[1] * sy) for q in m["points"]]
        outline = kind(m) == "closed shape" or (
            kind(m) == "freehand line" and len(pts) >= 3 and _length(m["points"]) > 150)
        if outline and _inside(p, pts):
            return 0.0
        best = min(best, float(_dist_to_line([p], pts)[0]))
    return best


# ---------- spots ----------

# At most this many spots are listed for Gemini (spots()).
MAX_SPOTS = 6


def spots(geo: dict, only_ids: set[str] | None = None) -> list[dict]:
    """
    Places where two different marks meet (they cross, including crossings
    along a "runs along" pair, or an end connects), from analyse()'s links, as [{"id": "x1", "x", "y", "mark_ids": [a, b],
    "kind"}]. A mark crossing itself (a wave's own loops) is not a link, so
    it never shows up. only_ids keeps spots that involve at least one of
    those marks (the selected ones). Design doc, item 17.
    """
    out = []
    for ln in geo["links"]:
        if ln["kind"] not in ("crosses", "runs_along", "connects"):
            continue
        if only_ids is not None and not ({ln["a"], ln["b"]} & only_ids):
            continue
        at = ln.get("at") or []
        points = at if at and isinstance(at[0], list) else [at]
        kind = "connects" if ln["kind"] == "connects" else "crosses"
        for p in points:
            if p:
                out.append({"x": p[0], "y": p[1], "mark_ids": [ln["a"], ln["b"]], "kind": kind})
    # Most telling first: two selected marks meeting, then crossings before
    # an end that only touches another mark.
    both = lambda s: only_ids is not None and set(s["mark_ids"]) <= only_ids
    out.sort(key=lambda s: (not both(s), s["kind"] != "crosses"))
    out = out[:MAX_SPOTS]
    for n, s in enumerate(out, 1):
        s["id"] = f"x{n}"
    return out


def spots_text(spot_list: list[dict]) -> str:
    words = {"crosses": "crosses", "connects": "meets"}
    return "\n".join(
        f"- {s['id']}: {s['mark_ids'][0]} {words[s['kind']]} {s['mark_ids'][1]} at ({s['x']}, {s['y']})"
        for s in spot_list
    ) or "none"


# ---------- prompt text ----------

def marks_table(geo: dict) -> str:
    """
    One short line per mark, in stroke order, with only what places it:
    a line's two ends, a closed shape's box, a dot's point. Flags only when
    true. Colour only when the marks use more than one. For the scene
    analysis prompt, next to the id labels on the planning image.
    """
    facts = geo["marks"]
    colours = len({f["color"] for f in facts}) > 1
    lines = []
    for f in facts:
        if f["kind"] == "dot":
            where = f"at {tuple(f['start'])}"
        elif f["kind"] == "closed shape":
            where = f"box {f['box']}"
        else:
            where = f"{tuple(f['start'])} to {tuple(f['end'])}"
        flags = [name for name, on in (("selected", f["selected"]), ("guide", f["guide"]),
                                       ("added from an AI suggestion", f.get("prompted"))) if on]
        lines.append(
            f"- {f['id']}: {f['kind']} {where}"
            + (f", {f['color']}" if colours else "")
            + (f" ({', '.join(flags)})" if flags else "")
        )
    return "\n".join(lines) or "none drawn"


def groups_text(geo: dict) -> str:
    words = {
        "runs_along": "runs along",
        "connects": "connects to",
        "crosses": "crosses",
        "contains": "contains",
        "inside": "sits inside",
    }
    lines = []
    for g in geo["groups"]:
        lines.append(f"- {g['id']}: {', '.join(g['mark_ids'])}" + (" (a single mark)" if len(g["mark_ids"]) == 1 else ""))
    if geo["links"]:
        lines.append("Links:")
        for ln in geo["links"]:
            at = ln.get("at")
            where = ""
            if at and isinstance(at[0], list):
                where = " at " + ", ".join(str(tuple(p)) for p in at)
            elif at:
                where = f" at {tuple(at)}"
            lines.append(f"- {ln['a']} {words[ln['kind']]} {ln['b']}{where}")
    return "\n".join(lines) or "none"
