"""
Pairs a sketcher's marked focal points ("where") with Gemini's labeled
focal_regions ("what") — e.g. a freely-placed point that happens to sit
on the roofline gets paired with focal_regions' "roofline" label, without
a second Gemini call.

Called by the focal-frame save (pair_focal_points) and the scene
analysis call (unmarked_region_indices, region_anchor). See claude/parking-lot.md,
"Focal-area marking: sketcher-marks-first + Gemini-suggests interaction",
and the design conversation that preceded it — the short version: an LLM
is good at *producing* grounded coordinates from an image (that's what
focal_regions.contour_points and perspective edges already lean on) but
not reliably good at spatial reasoning over a bare list of numbers with
no image in front of it. So this pairing is plain geometry, computed
here in Python against data Gemini already returned in the same scene
analysis response — no new Gemini call, no new dependency (shapely is
already a requirement, pulled in for geoalchemy2's WKB helpers; see
requirements.txt).

Entry points:
- pair_focal_points(): resolves each marked point to a focal_regions
  label (or "unmatched" if nothing's close).
- unmarked_region_indices(): which focal_regions no point pairs with and
  no mark runs through -- the missed focal areas the scene analysis turns into "The AI also
  noticed..." guided questions.
- region_anchor(): a point inside a region's outline, where the AI's
  suggested reticle is drawn.
- filter_perspective_near(): once a point is paired, narrows the
  scene's perspective edges down to just the ones near that region --
  e.g. so a prepared-prompt can offer "show the lines converging at the
  roofline" instead of all four scene-wide lines regardless of relevance.
"""
from shapely.geometry import Point, Polygon, LineString
from shapely import affinity
from shapely.validation import make_valid

from app.core.schemas import FocalRegion, region_points
from app.features.sketches.schemas import SketcherFocalPointInput, PairedFocalPoint
from app.core.mark_geometry import square_scale, visible_marks

# How close (0-1000 scale, same as every other coordinate in this app) an
# "own" point has to be to a region's boundary to count as a match when
# it doesn't land inside any region outright. Not citation-backed, same
# footing as the focal_regions cap-of-3 (design doc, Section 6) -- a
# starting default, easy to retune once this runs against real marks.
NEAREST_MATCH_THRESHOLD = 60.0

# How close a perspective line has to run to a paired region to count as
# "near" it for filter_perspective_near(). Looser than the point
# match above since a line can legitimately pass some distance from the
# object it's structurally related to (a roofline's vanishing line runs
# well past the roof itself).
LINE_NEAR_THRESHOLD = 120.0

# How close (0-1000 scale) one of the sketcher's marks has to pass to a
# region for that region to count as noticed. Tight on purpose: a mark
# has to run through or right along the outline, not just somewhere near
# it, so a long horizon line doesn't silence every suggestion under it.
MARK_NEAR_THRESHOLD = 15.0


def _region_polygon(region: FocalRegion) -> Polygon | None:
    """
    Builds a shapely Polygon from a flat [x1, y1, x2, y2, ...] contour.
    Gemini's contour tracing is a real-world vision output, not
    guaranteed-simple geometry -- a self-intersecting or degenerate ring
    is possible, so this repairs what it can via make_valid() and gives
    up (returns None) rather than letting a single bad region 500 the
    whole pairing pass.
    """
    coords = [tuple(p) for p in region_points(region)]
    if len(coords) < 3:
        return None
    try:
        poly = Polygon(coords)
        if not poly.is_valid:
            poly = make_valid(poly)
        # make_valid can return a GeometryCollection/MultiPolygon for a
        # badly self-intersecting ring -- take the largest polygonal
        # piece rather than fail the whole region.
        if poly.geom_type not in ("Polygon",):
            candidates = [g for g in getattr(poly, "geoms", []) if g.geom_type == "Polygon"]
            if not candidates:
                return None
            poly = max(candidates, key=lambda g: g.area)
        return poly if poly.is_valid and not poly.is_empty else None
    except Exception:
        return None


def pair_focal_points(
    points: list[SketcherFocalPointInput],
    focal_regions: list[FocalRegion],
) -> list[PairedFocalPoint]:
    """
    Resolves each point to a focal_regions label, in priority order:

    1. source == "adopted" with a valid region_ref -- already known, no
       geometry needed (the sketcher adopted *that specific* suggestion).
    2. Falls (or lands exactly on the boundary of) inside exactly one
       region's traced contour -- "contains".
    3. Not inside any region, but within NEAREST_MATCH_THRESHOLD of one
       -- "nearest". Ties broken by whichever region is closest.
    4. Nothing close enough -- "unmatched". This is a legitimate, honest
       outcome: the sketcher may have marked something Gemini's
       focal_regions never flagged (a gap between objects, a patch of
       wall), and forcing a label onto it would misrepresent that.
    """
    polygons = [_region_polygon(r) for r in focal_regions]
    out: list[PairedFocalPoint] = []

    for pt in points:
        if pt.source == "adopted" and pt.region_ref is not None and 0 <= pt.region_ref < len(focal_regions):
            out.append(PairedFocalPoint(
                **pt.model_dump(),
                paired_label=focal_regions[pt.region_ref].label,
                paired_region_ref=pt.region_ref,
                pairing_method="region_ref",
                pairing_distance=0.0,
            ))
            continue

        shapely_pt = Point(pt.x, pt.y)

        contains_idx = next(
            (i for i, poly in enumerate(polygons) if poly is not None and poly.contains(shapely_pt)),
            None,
        )
        if contains_idx is not None:
            out.append(PairedFocalPoint(
                **pt.model_dump(),
                paired_label=focal_regions[contains_idx].label,
                paired_region_ref=contains_idx,
                pairing_method="contains",
                pairing_distance=0.0,
            ))
            continue

        best_idx, best_dist = None, None
        for i, poly in enumerate(polygons):
            if poly is None:
                continue
            dist = poly.exterior.distance(shapely_pt)
            if best_dist is None or dist < best_dist:
                best_idx, best_dist = i, dist

        if best_idx is not None and best_dist <= NEAREST_MATCH_THRESHOLD:
            out.append(PairedFocalPoint(
                **pt.model_dump(),
                paired_label=focal_regions[best_idx].label,
                paired_region_ref=best_idx,
                pairing_method="nearest",
                pairing_distance=round(best_dist, 1),
            ))
            continue

        out.append(PairedFocalPoint(
            **pt.model_dump(),
            paired_label=None,
            paired_region_ref=None,
            pairing_method="unmatched",
            pairing_distance=round(best_dist, 1) if best_dist is not None else None,
        ))

    return out


def region_anchor(region: FocalRegion) -> tuple[int, int] | None:
    """
    Where to place a single reticle for a traced region: a point guaranteed
    to sit inside the outline (shapely's representative_point). A plain
    centroid can fall outside a concave shape, such as an L-shaped facade.
    None when the contour can't be turned into a polygon.
    """
    polygon = _region_polygon(region)
    if polygon is None:
        return None
    p = polygon.representative_point()
    return round(p.x), round(p.y)


def _mark_geometry(mark: dict):
    """A planning mark as a shapely line (or a point, for a single tap)."""
    pts = [tuple(p) for p in mark.get("points") or [] if isinstance(p, (list, tuple)) and len(p) == 2]
    if not pts:
        return None
    return Point(pts[0]) if len(pts) == 1 else LineString(pts)


def unmarked_region_indices(
    points: list[SketcherFocalPointInput],
    focal_regions: list[FocalRegion],
    marks: list[dict] | None = None,
    aspect: float | None = 1.0,
) -> list[int]:
    """
    Indices of focal_regions the sketcher hasn't noticed, in the regions'
    own order. A region counts as noticed when a focal point pairs with it
    (contains, then nearest), or when one of their planning marks runs
    through or right along its outline (MARK_NEAR_THRESHOLD). Every point
    is paired by geometry whatever its source, since an adopted point's
    region_ref may belong to an older analysis.
    """
    as_own = [SketcherFocalPointInput(x=p.x, y=p.y, source="own") for p in points]
    noticed = {
        pp.paired_region_ref
        for pp in pair_focal_points(as_own, focal_regions)
        if pp.paired_region_ref is not None
    }
    # Erased marks don't count: the sketcher took them back.
    # Distances in square units: frame units stretch with the photo's ratio
    # (design doc, item 17; mark_geometry.square_scale).
    sx, sy = square_scale(aspect)
    square = lambda g: affinity.scale(g, xfact=sx, yfact=sy, origin=(0, 0))
    mark_shapes = [square(g) for g in (_mark_geometry(m) for m in visible_marks(marks)) if g is not None]
    if mark_shapes:
        for i, region in enumerate(focal_regions):
            if i in noticed:
                continue
            polygon = _region_polygon(region)
            if polygon is not None and any(square(polygon).distance(g) <= MARK_NEAR_THRESHOLD for g in mark_shapes):
                noticed.add(i)
    return [i for i in range(len(focal_regions)) if i not in noticed]


def filter_perspective_near(
    perspective: dict | None,
    region: FocalRegion | None,
    max_distance: float = LINE_NEAR_THRESHOLD,
) -> dict | None:
    """
    Narrows a scene's perspective (scene_analysis/schemas.py Perspective:
    eye_level_y + vanishing_points, each with its flat edges list) down to
    the edges running near `region`. A vanishing point with no nearby edge
    is dropped. Eye level is kept as-is, since it belongs to the whole
    frame. Returns the same shape, so it drops straight into
    PerspectiveLinesOverlay.jsx.

    region=None (an unmatched point, or no point picked yet) returns None
    rather than "everything" -- there's nothing to target, and silently
    falling back to every line would misrepresent this as a deliberate
    choice when it isn't. The caller's UI should offer its existing
    "show all" mode as the explicit alternative instead.
    """
    if region is None or not perspective:
        return None
    polygon = _region_polygon(region)
    if polygon is None:
        return None

    kept_vps = []
    for vp in perspective.get("vanishing_points", []):
        edges = vp.get("edges", [])
        kept: list[int] = []
        for i in range(0, len(edges) - 3, 4):
            seg = edges[i:i + 4]
            line = LineString([(seg[0], seg[1]), (seg[2], seg[3])])
            if polygon.distance(line) <= max_distance:
                kept.extend(seg)
        if kept:
            kept_vps.append({**vp, "edges": kept})
    return {**perspective, "vanishing_points": kept_vps}


if __name__ == "__main__":
    # Small self-test, run directly (`python3 -m app.features.sketches.focal_pairing`
    # from backend/) -- this project has no pytest/tests dir (see
    # claude/parking-lot.md's verification convention: py_compile + a
    # manual run, not a checked-in test suite), so this mirrors that.
    roof = FocalRegion(label="roofline", contour_points=[100, 100, 300, 100, 300, 160, 100, 160])
    tree = FocalRegion(label="tree canopy", contour_points=[500, 400, 650, 380, 700, 480, 560, 520, 480, 470])
    regions = [roof, tree]

    points = [
        SketcherFocalPointInput(x=200, y=130, source="own"),           # inside roof -> contains
        SketcherFocalPointInput(x=110, y=175, source="own"),           # just under roof -> nearest
        SketcherFocalPointInput(x=900, y=900, source="own"),           # far from everything -> unmatched
        SketcherFocalPointInput(x=0, y=0, source="adopted", region_ref=1),  # adopted tree, coords irrelevant -> region_ref
    ]
    results = pair_focal_points(points, regions)
    for p, r in zip(points, results):
        print(f"({p.x:>4},{p.y:>4}) source={p.source:<8} -> {r.pairing_method:<10} label={r.paired_label!r:<16} dist={r.pairing_distance}")

    assert results[0].pairing_method == "contains" and results[0].paired_label == "roofline"
    assert results[1].pairing_method == "nearest" and results[1].paired_label == "roofline"
    assert results[2].pairing_method == "unmatched" and results[2].paired_label is None
    assert results[3].pairing_method == "region_ref" and results[3].paired_label == "tree canopy"

    perspective = {
        "eye_level_y": 90,
        "kind": "two_point",
        "vanishing_points": [
            {"x": 1400, "y": 90, "edges": [100, 100, 400, 90, 520, 410, 900, 700]},  # roof edge, tree edge
            {"x": -600, "y": 90, "edges": [900, 50, 950, 900]},                       # near neither
        ],
    }
    near_roof = filter_perspective_near(perspective, roof)
    near_tree = filter_perspective_near(perspective, tree)
    near_none = filter_perspective_near(perspective, None)
    print("near roof:", near_roof)
    print("near tree:", near_tree)
    print("near none (region=None):", near_none)
    assert near_roof["vanishing_points"] == [{"x": 1400, "y": 90, "edges": [100, 100, 400, 90]}]
    assert near_tree["vanishing_points"] == [{"x": 1400, "y": 90, "edges": [520, 410, 900, 700]}]
    assert near_roof["eye_level_y"] == 90
    assert near_none is None

    assert unmarked_region_indices(points[:1], regions) == [1]      # roof marked, tree missed
    assert unmarked_region_indices([], regions) == [0, 1]
    # A mark running through the tree counts as noticing it; one far away doesn't.
    through_tree = {"color": "#ffd400", "width": 6, "points": [[450, 450], [750, 450]]}
    far_away = {"color": "#ffd400", "width": 6, "points": [[0, 950], [1000, 950]]}
    assert unmarked_region_indices(points[:1], regions, [through_tree]) == []
    assert unmarked_region_indices(points[:1], regions, [far_away]) == [1]
    ax, ay = region_anchor(tree)
    assert _region_polygon(tree).contains(Point(ax, ay))

    print("\nAll self-test assertions passed.")
