import { computeImageBox } from './cropMath'

export const NEAREST_MATCH_THRESHOLD = 60

// Builds the same "box" cropMath.computeImageBox computes for the live
// preview/bake, but against a resolution-independent 1000-unit frame
// (1000 tall, aspectRatio*1000 wide) instead of actual on-screen or
// export pixels -- so the result is directly in the 0-1000-per-axis
// normalized space every other coordinate in this app already uses.
function unitBox(aspectRatio, transform, naturalSize) {
  const frameWidth = aspectRatio * 1000
  const frameHeight = 1000
  return {
    frameWidth,
    frameHeight,
    box: computeImageBox(
      frameWidth,
      frameHeight,
      naturalSize.width,
      naturalSize.height,
      transform.zoom,
      transform.offset_x,
      transform.offset_y
    ),
  }
}

// frame-normalized (0-1000 per axis, relative to THIS frame) -> original
// photo-normalized (0-1000 per axis, relative to the untouched original
// image's own width/height -- a fixed, frame-independent reference).
export function toOriginalSpace(point, aspectRatio, transform, naturalSize) {
  const { frameWidth, frameHeight, box } = unitBox(aspectRatio, transform, naturalSize)
  const px = (point.x / 1000) * frameWidth
  const py = (point.y / 1000) * frameHeight
  return {
    x: ((px - box.left) / box.width) * 1000,
    y: ((py - box.top) / box.height) * 1000,
  }
}

// Inverse of the above: original photo-normalized -> frame-normalized for
// a given candidate frame. Also reports whether the point is still
// visible inside that frame (both axes within [0, 1000]) -- the crop-
// exclusion check in FocalFrameEditor.jsx is just this flag going false.
export function toFrameSpace(point, aspectRatio, transform, naturalSize) {
  const { frameWidth, frameHeight, box } = unitBox(aspectRatio, transform, naturalSize)
  const px = box.left + (point.x / 1000) * box.width
  const py = box.top + (point.y / 1000) * box.height
  const x = (px / frameWidth) * 1000
  const y = (py / frameHeight) * 1000
  return { x, y, inFrame: x >= 0 && x <= 1000 && y >= 0 && y <= 1000 }
}

// Ray-casting point-in-polygon, `points` as a flat [x1,y1,x2,y2,...] list
// (FocalRegion.contour_points' own shape -- no reshaping needed at the
// call site).
export function pointInPolygon(x, y, points) {
  let inside = false
  const n = points.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i * 2]
    const yi = points[i * 2 + 1]
    const xj = points[j * 2]
    const yj = points[j * 2 + 1]
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function distanceToSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
}

function distanceToPolygonBoundary(x, y, points) {
  const n = points.length / 2
  let min = Infinity
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = distanceToSegment(x, y, points[i * 2], points[i * 2 + 1], points[j * 2], points[j * 2 + 1])
    if (d < min) min = d
  }
  return min
}

// True when (x, y) already lands inside `region`'s traced contour, or
// within NEAREST_MATCH_THRESHOLD of its boundary -- the same two
// "already found" cases focal_pairing.py's pair_focal_points() resolves
// to "contains" / "nearest" rather than "unmatched".
export function pointNearRegion(x, y, region, threshold = NEAREST_MATCH_THRESHOLD) {
  const pts = region.contour_points || []
  if (pts.length < 6) return false
  if (pointInPolygon(x, y, pts)) return true
  return distanceToPolygonBoundary(x, y, pts) <= threshold
}

// Centroid of a region's traced contour -- used as the on-canvas position
// for a Gemini suggestion the sketcher adopts (there's no single "the"
// point on an irregular outline, so the shape's average vertex position
// stands in for one, same as the earlier FocalPointOverlay.jsx prototype
// component this feature supersedes).
export function regionCentroid(region) {
  const pts = region.contour_points || []
  let sx = 0
  let sy = 0
  let n = 0
  for (let i = 0; i + 1 < pts.length; i += 2) {
    sx += pts[i]
    sy += pts[i + 1]
    n += 1
  }
  return n === 0 ? null : { x: sx / n, y: sy / n }
}
