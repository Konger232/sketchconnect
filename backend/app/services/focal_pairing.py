"""
Pairs a sketcher's marked focal points ("where") with Gemini's labeled
focal_regions ("what") — e.g. a freely-placed point that happens to sit
on the roofline gets paired with focal_regions' "roofline" label, without
a second Gemini call.

Prototype-stage: no endpoint calls this yet. See claude/parking-lot.md,
"Focal-area marking: sketcher-marks-first + Gemini-suggests interaction",
and the design conversation that preceded it — the short version: an LLM
is good at *producing* grounded coordinates from an image (that's what
focal_regions.contour_points and perspective_lines already lean on) but
not reliably good at spatial reasoning over a bare list of numbers with
no image in front of it. So this pairing is plain geometry, computed
here in Python against data Gemini already returned in the same scene
analysis response — no new Gemini call, no new dependency (shapely is
already a requirement, pulled in for geoalchemy2's WKB helpers; see
requirements.txt).

Two entry points:
- pair_focal_points(): resolves each marked point to a focal_regions
  label (or "unmatched" if nothing's close).
- filter_perspective_lines_near(): once a point is paired, narrows the
  scene's perspective_lines down to just the ones near that region --
  e.g. so a prepared-prompt can offer "show the lines converging at the
  roofline" instead of all four scene-wide lines regardless of relevance.
"""
from shapely.geometry import Point, Polygon, LineString
from shapely.validation import make_valid

from ..schemas import FocalRegion, SketcherFocalPointInput, PairedFocalPoint

# How close (0-1000 scale, same as every other coordinate in this app) an
# "own" point has to be to a region's boundary to count as a match when
# it doesn't land inside any region outright. Not citation-backed, same
# footing as the focal_regions cap-of-3 (design doc, Section 6) -- a
# starting default, easy to retune once this runs against real marks.
NEAREST_MATCH_THRESHOLD = 60.0

# How close a perspective line has to run to a paired region to count as
# "near" it for filter_perspective_lines_near(). Looser than the point
# match above since a line can legitimately pass some distance from the
# object it's structurally related to (a roofline's vanishing line runs
# well past the roof itself).
LINE_NEAR_THRESHOLD = 120.0


def _region_polygon(region: FocalRegion) -> Polygon | None:
    """
    Builds a shapely Polygon from a flat [x1, y1, x2, y2, ...] contour.
    Gemini's contour tracing is a real-world vision output, not
    guaranteed-simple geometry -- a self-intersecting or degenerate ring
    is possible, so this repairs what it can via make_valid() and gives
    up (returns None) rather than letting a single bad region 500 the
    whole pairing pass.
    """
    coords = list(zip(region.contour_points[0::2], region.contour_points[1::2]))
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


def filter_perspective_lines_near(
    perspective_lines: list[int],
    region: FocalRegion | None,
    max_distance: float = LINE_NEAR_THRESHOLD,
) -> list[int]:
    """
    Narrows a scene's perspective_lines (flat [x1,y1,x2,y2, x1,y1,x2,y2, ...]
    segments) down to the ones running near `region`. Returns the same
    flat-list shape, so it drops straight into whatever already consumes
    perspective_lines (PerspectiveLinesOverlay.jsx today).

    region=None (an unmatched point, or no point picked yet) returns an
    empty list rather than "all lines" -- there's nothing to target, and
    silently falling back to every line would misrepresent this as a
    deliberate choice when it isn't. The caller's UI should offer its
    existing "show all" mode as the explicit alternative instead.
    """
    if region is None:
        return []
    polygon = _region_polygon(region)
    if polygon is None:
        return []

    segments = [perspective_lines[i:i + 4] for i in range(0, len(perspective_lines) - 3, 4)]
    kept: list[int] = []
    for seg in segments:
        line = LineString([(seg[0], seg[1]), (seg[2], seg[3])])
        if polygon.distance(line) <= max_distance:
            kept.extend(seg)
    return kept


if __name__ == "__main__":
    # Small self-test, run directly (`python3 -m app.services.focal_pairing`
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

    perspective_lines = [
        100, 100, 400, 90,    # near the roof
        520, 410, 900, 700,   # near the tree
        900, 50, 950, 900,    # near neither
    ]
    near_roof = filter_perspective_lines_near(perspective_lines, roof)
    near_tree = filter_perspective_lines_near(perspective_lines, tree)
    near_none = filter_perspective_lines_near(perspective_lines, None)
    print("near roof:", near_roof)
    print("near tree:", near_tree)
    print("near none (region=None):", near_none)
    assert near_roof == [100, 100, 400, 90]
    assert near_tree == [520, 410, 900, 700]
    assert near_none == []

    print("\nAll self-test assertions passed.")
