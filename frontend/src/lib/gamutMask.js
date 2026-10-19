// The gamut mask as shapes on the wheel (design doc, item 37), after
// Krita's gamut masks: one or more shapes, and the colours inside them are
// the scheme. Everything here works in unit space: the wheel's centre is
// (0, 0) and its radius 1.
//
//   { type: 'polygon', corners: [{ h, c }] }
//   { type: 'circle', center: { h, c }, r }
import { Color, mix } from 'spectral.js'
import { centroid, pointInPolygon, wheelToXY, xyToWheel } from './colorWheel'

export const toUnit = (p) => wheelToXY(p, 2).map((v) => v - 1)
export const fromUnit = ([x, y]) => {
  const w = xyToWheel(x + 1, y + 1, 2)
  return { h: Math.round(w.h * 10) / 10, c: Math.round(Math.min(1, w.c) * 1000) / 1000 }
}
const inWheel = ([x, y], pad = 0) => Math.hypot(x, y) + pad <= 1.001

// ---- the starting shapes (the icons under the wheel) ----

const polygon = (pts) => ({ type: 'polygon', corners: pts.map(fromUnit) })
export const PRESETS = {
  // An even triad in the middle.
  triangle: () => polygon([0, 120, 240].map((a) => [0.6 * Math.cos(((a - 90) * Math.PI) / 180), 0.6 * Math.sin(((a - 90) * Math.PI) / 180)])),
  // A long diamond across the centre: two neighbouring families, muted.
  diamond: () => polygon([[0, -0.72], [0.3, 0], [0, 0.72], [-0.3, 0]]),
  // Mood and accent: a big circle, and a small one across the wheel.
  circles: () => [
    { type: 'circle', center: fromUnit([-0.3, 0.25]), r: 0.42 },
    { type: 'circle', center: fromUnit([0.52, -0.43]), r: 0.14 },
  ],
}
export const presetShapes = (name) => [].concat(PRESETS[name]())
export const DEFAULT_SHAPES = presetShapes('triangle')

// An older saved mask ({ corners }) is one polygon.
export function readMask(saved) {
  if (saved?.shapes?.length) return saved.shapes
  if (saved?.corners?.length >= 3) return [{ type: 'polygon', corners: saved.corners }]
  return null
}

// ---- geometry ----

export const unitCorners = (s) => s.corners.map(toUnit)

export function shapeContains(s, p) {
  if (s.type === 'circle') { const c = toUnit(s.center); return Math.hypot(p[0] - c[0], p[1] - c[1]) <= s.r }
  return pointInPolygon(p, unitCorners(s))
}
export const maskContains = (shapes, p) => shapes.some((s) => shapeContains(s, p))

function nearestOnSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  return [ax + t * dx, ay + t * dy]
}

// The point itself when inside the mask, else the nearest point inside it.
export function clampToMask(shapes, p) {
  if (maskContains(shapes, p)) return p
  let best = p, bd = Infinity
  for (const s of shapes) {
    let q
    if (s.type === 'circle') {
      const c = toUnit(s.center), d = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1
      q = [c[0] + ((p[0] - c[0]) / d) * s.r, c[1] + ((p[1] - c[1]) / d) * s.r]
      const dd = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
      if (dd < bd) { bd = dd; best = q }
    } else {
      const pts = unitCorners(s)
      for (let i = 0; i < pts.length; i++) {
        q = nearestOnSegment(p, pts[i], pts[(i + 1) % pts.length])
        const dd = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
        if (dd < bd) { bd = dd; best = q }
      }
    }
  }
  return best
}

export function shapeSize(s) {
  if (s.type === 'circle') return s.r
  const pts = unitCorners(s), [cx, cy] = centroid(pts)
  return pts.reduce((sum, [x, y]) => sum + Math.hypot(x - cx, y - cy), 0) / pts.length
}

// Scales a shape about its centre to `size`, kept inside the wheel.
export function resizeShape(s, size) {
  if (s.type === 'circle') {
    const c = toUnit(s.center)
    return { ...s, r: Math.max(0.04, Math.min(size, 1 - Math.hypot(...c))) }
  }
  const pts = unitCorners(s), [cx, cy] = centroid(pts)
  let f = size / (shapeSize(s) || 1e-6)
  for (const [x, y] of pts) {
    const dx = x - cx, dy = y - cy
    const a = dx * dx + dy * dy, b = 2 * (cx * dx + cy * dy), k = cx * cx + cy * cy - 1
    if (a > 0) f = Math.min(f, (-b + Math.sqrt(Math.max(0, b * b - 4 * a * k))) / (2 * a))
  }
  return { ...s, corners: pts.map(([x, y]) => fromUnit([cx + (x - cx) * f, cy + (y - cy) * f])) }
}

// Moves a shape by (dx, dy); null if it would leave the wheel.
export function moveShape(s, dx, dy) {
  if (s.type === 'circle') {
    const c = toUnit(s.center), n = [c[0] + dx, c[1] + dy]
    return inWheel(n, s.r) ? { ...s, center: fromUnit(n) } : null
  }
  const pts = unitCorners(s).map(([x, y]) => [x + dx, y + dy])
  return pts.every((p) => inWheel(p)) ? { ...s, corners: pts.map(fromUnit) } : null
}

// ---- recipes: how to mix a colour from the sketcher's paints ----

const oklab = (hex) => new Color(hex).OKLab
// Watercolour is lightened with water, so lightness counts for less than
// hue and intensity when matching a mix to a colour.
const dE = (a, b) => Math.hypot(0.3 * (a[0] - b[0]), a[1] - b[1], a[2] - b[2])
const PAIR_PARTS = [[1, 1], [2, 1], [1, 2], [3, 1], [1, 3]]
const TRIO_PARTS = []
for (let a = 1; a <= 3; a++) for (let b = 1; b <= 3; b++) for (let c = 1; c <= 3; c++) TRIO_PARTS.push([a, b, c])
const SIMPLER = 0.012 // a mix of more paints must beat a simpler one by this much

/**
 * The closest mix to `hex` from `paints`, at most three paints, in small
 * whole parts, mixed as pigment (spectral.js, Kubelka-Munk). Returns
 * { parts: [[paint, n]], hex, delta, water } with delta the OKLab distance
 * (lightness weighted down) and water 'more' | 'less' | null.
 */
export function bestRecipe(hex, paints) {
  if (!paints.length) return null
  const target = oklab(hex)
  const colors = paints.map((p) => new Color(p.hex))
  const score = (entries) => {
    const m = entries.length === 1 ? colors[entries[0][0]] : mix(...entries.map(([i, n]) => [colors[i], n]))
    return { mixHex: m.toString(), delta: dE(m.OKLab, target) + SIMPLER * (entries.length - 1), entries }
  }
  let best = null
  const consider = (r) => { if (!best || r.delta < best.delta) best = r }
  paints.forEach((_, i) => consider(score([[i, 1]])))
  const pairs = []
  for (let i = 0; i < paints.length; i++) {
    for (let j = i + 1; j < paints.length; j++) {
      for (const [a, b] of PAIR_PARTS) {
        const r = score([[i, a], [j, b]])
        pairs.push(r)
        consider(r)
      }
    }
  }
  // Three paints: only among the paints in the closest pairs.
  pairs.sort((x, y) => x.delta - y.delta)
  const pool = [...new Set(pairs.slice(0, 12).flatMap((r) => r.entries.map(([i]) => i)))].slice(0, 6)
  for (let x = 0; x < pool.length; x++) {
    for (let y = x + 1; y < pool.length; y++) {
      for (let z = y + 1; z < pool.length; z++) {
        for (const [a, b, c] of TRIO_PARTS) consider(score([[pool[x], a], [pool[y], b], [pool[z], c]]))
      }
    }
  }
  const lighter = target[0] - oklab(best.mixHex)[0]
  return {
    parts: best.entries.map(([i, n]) => [paints[i], n]),
    hex: best.mixHex,
    delta: best.delta - SIMPLER * (best.entries.length - 1),
    // How to reach the colour's lightness: more water, or a stronger layer.
    water: lighter > 0.08 ? 'more' : lighter < -0.08 ? 'less' : null,
  }
}

// "2 parts Ultramarine Blue, 1 part Burnt Sienna"
export function recipeLine(recipe) {
  if (recipe.parts.length === 1) return `${recipe.parts[0][0].name}, on its own`
  // Reduce 2:2 to 1:1.
  const g = recipe.parts.reduce((a, [, n]) => { let x = a, y = n; while (y) [x, y] = [y, x % y]; return x }, 0)
  return recipe.parts.map(([p, n]) => `${n / g} ${n / g === 1 ? 'part' : 'parts'} ${p.name}`).join(', ')
}
