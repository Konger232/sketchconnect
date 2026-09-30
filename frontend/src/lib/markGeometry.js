/**
 * Mark groups for the Select tool (Marks.jsx): marks that touch or cross
 * AND were drawn one right after the other read as one shape, so a second
 * tap can select the whole shape. Stroke order stops a long line that
 * touches everything from merging the whole drawing into one shape.
 *
 * A browser copy of the grouping in backend/app/core/mark_geometry.py.
 * The backend version also names each link and feeds the AI; this one only
 * answers "which marks form one shape". Keep the constants in sync.
 *
 * Coordinates are 0-1000 frame units, the same as Marks.jsx: 0-1000 across
 * the framed photo and 0-1000 down, whatever its ratio. A unit across and a
 * unit down are only the same size on a 1:1 frame, so every distance test
 * runs in square units: pass the frame's aspect (width / height), and the
 * points are scaled so the long side is 1000 (squareScale). Points handed
 * back (a snapped spot) are in frame units again.
 */

// (sx, sy) that turn frame units into square units, long side at 1000.
export function squareScale(aspect) {
  const a = aspect > 0 ? aspect : 1
  return a >= 1 ? [1, 1 / a] : [a, 1]
}

// A copy of the mark in square units. width is in frame units across.
function toSquare(m, sx, sy) {
  return { ...m, points: m.points.map((p) => [p[0] * sx, p[1] * sy]), width: (m.width ?? 6) * sx }
}

// Extra reach (frame units) on top of half of each line's width.
const SNAP = 15
// "Runs along": this much of one mark (or 40% of the shorter) lies on the other.
const ALONG_MIN = 60
// A straight line this long is a guide and never joins a shape.
const GUIDE_LENGTH = 500
// A big mark never joins: its box spans more than BIG_MARK_LONG in one
// direction, or more than BIG_MARK in both.
const BIG_MARK = 500
const BIG_MARK_LONG = 700
// Marks join only when drawn this close in stroke order (1 = consecutive).
const ORDER_WINDOW = 1
// Resample step for "runs along", and the simplify tolerance.
const STEP = 5
const SIMPLIFY = 3

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

function length(pts) {
  let n = 0
  for (let i = 0; i < pts.length - 1; i++) n += dist(pts[i], pts[i + 1])
  return n
}

export function markKind(mark) {
  const pts = mark.points || []
  if (pts.length < 2) return 'dot'
  const len = length(pts)
  const chord = dist(pts[0], pts[pts.length - 1])
  if (len > 150 && chord < 0.15 * len) return 'closed shape'
  return chord >= 0.95 * len ? 'straight line' : 'freehand line'
}

function isGuide(mark) {
  return markKind(mark) === 'straight line' && length(mark.points) >= GUIDE_LENGTH
}

function segPointDist(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return dist(p, [a[0] + t * dx, a[1] + t * dy])
}

function pointToLine(p, pts) {
  if (pts.length === 1) return dist(p, pts[0])
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, segPointDist(p, pts[i], pts[i + 1]))
  return best
}

// Douglas-Peucker, iterative.
function simplify(pts, tol = SIMPLIFY) {
  if (pts.length < 3) return pts
  const keep = new Array(pts.length).fill(false)
  keep[0] = keep[pts.length - 1] = true
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let best = 0
    let bestI = -1
    for (let i = a + 1; i < b; i++) {
      const d = segPointDist(pts[i], pts[a], pts[b])
      if (d > best) { best = d; bestI = i }
    }
    if (bestI >= 0 && best > tol) {
      keep[bestI] = true
      stack.push([a, bestI], [bestI, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

function resample(pts, step = STEP) {
  if (pts.length < 2) return [pts[0]]
  const out = [pts[0]]
  let carry = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const seg = dist(a, b)
    let d = step - carry
    while (d <= seg) {
      const t = d / seg
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
      d += step
    }
    carry = seg - (d - step)
  }
  if (dist(out[out.length - 1], pts[pts.length - 1]) > 0.5) out.push(pts[pts.length - 1])
  return out
}

function longestRun(points, other, reach) {
  let best = 0
  let run = 0
  for (const p of points) {
    run = pointToLine(p, other) <= reach ? run + 1 : 0
    if (run > best) best = run
  }
  return best * STEP
}

function segmentsCross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]]
  const s = [d[0] - c[0], d[1] - c[1]]
  const den = r[0] * s[1] - r[1] * s[0]
  if (den === 0) return false
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

function anyCrossing(pa, pb) {
  for (let i = 0; i < pa.length - 1; i++) {
    for (let j = 0; j < pb.length - 1; j++) {
      if (segmentsCross(pa[i], pa[i + 1], pb[j], pb[j + 1])) return true
    }
  }
  return false
}

function box(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

// True when two marks run along, connect or cross (the links that join a shape).
function joins(a, b, pa, pb) {
  const reach = ((a.width ?? 6) + (b.width ?? 6)) / 2 + SNAP
  if (pa.length > 1 && pb.length > 1) {
    const shared = Math.max(longestRun(resample(pb), pa, reach), longestRun(resample(pa), pb, reach))
    const need = Math.max(Math.min(ALONG_MIN, 0.4 * Math.min(length(pa), length(pb))), 4 * reach)
    if (shared >= need) return true
  }
  for (const end of [pb[0], pb[pb.length - 1]]) if (pointToLine(end, pa) <= reach) return true
  for (const end of [pa[0], pa[pa.length - 1]]) if (pointToLine(end, pb) <= reach) return true
  return pa.length > 1 && pb.length > 1 && anyCrossing(pa, pb)
}

/**
 * Groups for the given marks. Erased marks are left out. aspect is the
 * frame's width / height. Returns a Map
 * from each visible mark's id to the ids in its shape (itself included),
 * in stroke order.
 */
export function markGroups(marks, aspect = 1) {
  const [sx, sy] = squareScale(aspect)
  const visible = (marks || []).filter((m) => m.points?.length && !m.erased).map((m) => toSquare(m, sx, sy))
  const simple = visible.map((m) => simplify(m.points))
  const boxes = visible.map((m) => box(m.points))
  // Guides and big marks never join a shape.
  const guides = visible.map((m, i) => {
    const w = boxes[i][2] - boxes[i][0]
    const h = boxes[i][3] - boxes[i][1]
    return isGuide(m) || Math.max(w, h) > BIG_MARK_LONG || Math.min(w, h) > BIG_MARK
  })
  const parent = visible.map((_, i) => i)
  const root = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }

  for (let i = 0; i < visible.length; i++) {
    if (guides[i]) continue
    for (let j = i + 1; j <= Math.min(i + ORDER_WINDOW, visible.length - 1); j++) {
      if (guides[j] || root(i) === root(j)) continue
      const reach = ((visible[i].width ?? 6) + (visible[j].width ?? 6)) / 2 + SNAP
      const [a, b] = [boxes[i], boxes[j]]
      if (a[2] + reach < b[0] || b[2] + reach < a[0] || a[3] + reach < b[1] || b[3] + reach < a[1]) continue
      if (joins(visible[i], visible[j], simple[i], simple[j])) parent[root(j)] = root(i)
    }
  }

  const byRoot = new Map()
  visible.forEach((m, i) => {
    const r = root(i)
    if (!byRoot.has(r)) byRoot.set(r, [])
    byRoot.get(r).push(m.id)
  })
  const out = new Map()
  for (const ids of byRoot.values()) for (const id of ids) out.set(id, ids)
  return out
}

// ---------- spots (design doc, item 17) ----------

// How close (frame units) a tap has to be to a crossing or a line to mark
// a spot there.
const SPOT_REACH = 40

function crossingPoint(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]]
  const s = [d[0] - c[0], d[1] - c[1]]
  const den = r[0] * s[1] - r[1] * s[0]
  if (den === 0) return null
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * r[0], a[1] + t * r[1]] : null
}

function nearestOnLine(p, pts) {
  if (pts.length === 1) return pts[0]
  let best = null
  let bestD = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
    const q = [a[0] + t * dx, a[1] + t * dy]
    const d = dist(p, q)
    if (d < bestD) { bestD = d; best = q }
  }
  return best
}

const round1 = (n) => Math.round(n * 10) / 10

/**
 * Where a tap marks a spot on the sketcher's lines: the nearest place two
 * different marks cross within SPOT_REACH, or else the nearest point on
 * one mark. { x, y, mark_ids } in frame units, or null when the tap is not
 * near any line. p is in frame units; aspect is the frame's width / height. A mark crossing itself (a wave's own loops) never counts.
 */
export function snapSpot(marks, p, aspect = 1) {
  const [sx, sy] = squareScale(aspect)
  const back = (q) => ({ x: round1(q[0] / sx), y: round1(q[1] / sy) })
  p = [p[0] * sx, p[1] * sy]
  const near = (marks || [])
    .filter((m) => m.points?.length && !m.erased)
    .map((m) => ({ m, pts: simplify(toSquare(m, sx, sy).points) }))
    .filter(({ pts }) => pointToLine(p, pts) <= SPOT_REACH)
  if (!near.length) return null

  let best = null
  let bestD = SPOT_REACH
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const [pa, pb] = [near[i].pts, near[j].pts]
      for (let k = 0; k < pa.length - 1; k++) {
        for (let l = 0; l < pb.length - 1; l++) {
          const c = crossingPoint(pa[k], pa[k + 1], pb[l], pb[l + 1])
          if (c && dist(c, p) <= bestD) {
            bestD = dist(c, p)
            best = { ...back(c), mark_ids: [near[i].m.id, near[j].m.id] }
          }
        }
      }
    }
  }
  if (best) return best

  let one = null
  bestD = Infinity
  for (const { m, pts } of near) {
    const q = nearestOnLine(p, pts)
    if (dist(q, p) < bestD) {
      bestD = dist(q, p)
      one = { ...back(q), mark_ids: [m.id] }
    }
  }
  return one
}
