// The gamut mask's maths (design doc, item 37).
//
// The wheel is Tobey Sanford's Yurmby wheel: yellow, red, magenta, blue,
// cyan and green, evenly spaced. That is the order of the screen colour
// wheel (hue), so a point on the wheel is { h, c }: h the hue in degrees,
// c the intensity from 0 (grey centre) to 1 (rim). The hues run clockwise
// yellow, green, cyan, blue, magenta, red, as on the printed wheels.
import { Color, mix } from 'spectral.js'

// ---- colour conversions ----

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

export function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

// A point on the wheel for a colour, and the colour at a point (full
// lightness band: the rim is the pure hue, the centre mid grey).
export function hexToWheel(hex) {
  const [h, s] = rgbToHsl(...hexToRgb(hex))
  return { h, c: s }
}
export const wheelToHex = ({ h, c }) => toHex(hslToRgb(h, c, 0.5))

// Where a paint sits on the wheel: its hue, and a distance from the centre
// that matches its chroma (max - min of R, G, B) to the tiles', which are
// drawn at 55% lightness. HSL saturation alone pushes whites, darks and
// earths too far out (Titanium White landed among the oranges).
export function paintToWheel(hex) {
  const rgb = hexToRgb(hex)
  const chroma = (Math.max(...rgb) - Math.min(...rgb)) / 255
  return { h: rgbToHsl(...rgb)[0], c: Math.min(1, chroma / 0.9) }
}

// ---- wheel geometry: { h, c } <-> x, y in a square of side `size` ----

// Screen angle in degrees, clockwise from the right. As the reference
// wheel picked on October 19, 2026: magenta at 3 o'clock, then clockwise
// red, yellow (about 7 o'clock), green, cyan and blue.
export const angleOf = (h) => h + 60

export function wheelToXY({ h, c }, size) {
  const r = size / 2
  const a = (angleOf(h) * Math.PI) / 180
  return [r + c * r * Math.cos(a), r + c * r * Math.sin(a)]
}

export function xyToWheel(x, y, size) {
  const r = size / 2
  const dx = x - r, dy = y - r
  const c = Math.hypot(dx, dy) / r
  const a = (Math.atan2(dy, dx) * 180) / Math.PI
  const h = (((a - 60) % 360) + 360) % 360
  return { h, c }
}

// ---- a plain name for a free corner's hue ----
// Paints carry their own hand-written lean (data/paints.js). A corner
// dropped on empty wheel just gets its hue's name.
const HUE_NAMES = [
  [15, 'red'], [45, 'orange'], [70, 'yellow'], [100, 'yellow-green'], [150, 'green'], [190, 'blue-green'],
  [250, 'blue'], [285, 'violet'], [335, 'magenta'], [360, 'red'],
]
export function hueName({ h, c }) {
  if (c < 0.12) return 'grey'
  const name = HUE_NAMES.find(([end]) => h < end)[1]
  return c < 0.4 ? `muted ${name}` : name
}

// ---- polygons ----

export function pointInPolygon([x, y], pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function nearestOnSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  return [ax + t * dx, ay + t * dy]
}

// The point itself when inside the shape, else the nearest point on its edge.
export function clampToPolygon(p, pts) {
  if (pts.length < 3 || pointInPolygon(p, pts)) return p
  let best = pts[0], bd = Infinity
  for (let i = 0; i < pts.length; i++) {
    const q = nearestOnSegment(p, pts[i], pts[(i + 1) % pts.length])
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
    if (d < bd) { bd = d; best = q }
  }
  return best
}

export function centroid(pts) {
  const n = pts.length
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]
}

function barycentric(p, a, b, c) {
  const v0 = [b[0] - a[0], b[1] - a[1]], v1 = [c[0] - a[0], c[1] - a[1]], v2 = [p[0] - a[0], p[1] - a[1]]
  const d00 = v0[0] * v0[0] + v0[1] * v0[1], d01 = v0[0] * v1[0] + v0[1] * v1[1]
  const d11 = v1[0] * v1[0] + v1[1] * v1[1], d20 = v2[0] * v0[0] + v2[1] * v0[1], d21 = v2[0] * v1[0] + v2[1] * v1[1]
  const den = d00 * d11 - d01 * d01
  if (!den) return null
  const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den
  return [1 - v - w, v, w]
}

// ---- recipes ----

// Weights of the corners (at most three) that mix to point p, from the
// fan of triangles from corner 0. Points on an edge use its two corners.
export function weightsAt(p, pts) {
  if (pts.length === 1) return [[0, 1]]
  if (pts.length === 2) {
    const q = nearestOnSegment(p, pts[0], pts[1])
    const t = Math.hypot(q[0] - pts[0][0], q[1] - pts[0][1]) / (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) || 1)
    return [[0, 1 - t], [1, t]]
  }
  let best = null, bestScore = -Infinity
  for (let i = 1; i < pts.length - 1; i++) {
    const w = barycentric(p, pts[0], pts[i], pts[i + 1])
    if (!w) continue
    const score = Math.min(...w) // >= 0 when inside this triangle
    if (score > bestScore) { bestScore = score; best = [[0, w[0]], [i, w[1]], [i + 1, w[2]]] }
  }
  const clipped = best.map(([k, w]) => [k, Math.max(0, w)])
  const sum = clipped.reduce((s, [, w]) => s + w, 0) || 1
  return clipped.map(([k, w]) => [k, w / sum]).filter(([, w]) => w > 0.08)
}

// Weights to small whole parts: 0.66 / 0.34 -> 2 and 1. At most 4 parts each.
export function toParts(weights) {
  let best = null, bestErr = Infinity
  const max = Math.max(...weights.map(([, w]) => w))
  for (let m = 1; m <= 4; m++) {
    const parts = weights.map(([k, w]) => [k, Math.round((w / max) * m)]).filter(([, n]) => n > 0)
    const total = parts.reduce((s, [, n]) => s + n, 0)
    const err = weights.reduce((s, [k, w]) => s + Math.abs(w - ((parts.find(([j]) => j === k)?.[1] || 0) / total)), 0)
    if (err < bestErr - 0.04) { bestErr = err; best = parts }
  }
  return best
}

// The mixed colour of corners in parts, as pigment mixes (Kubelka-Munk),
// not as screen blending: blue and yellow make green, not grey.
export function mixHex(entries) {
  if (entries.length === 1) return entries[0][0]
  try {
    return mix(...entries.map(([hex, w]) => [new Color(hex), w])).toString()
  } catch {
    return entries[0][0]
  }
}

// "2 parts Ultramarine, 1 part Burnt Sienna"
export function recipeText(parts, names) {
  if (parts.length === 1) return `${names[parts[0][0]]}, on its own`
  return parts.map(([k, n]) => `${n} ${n === 1 ? 'part' : 'parts'} ${names[k]}`).join(', ')
}

// Strong stainers carry further in a mix.
const STRONG = ['pb15', 'pg7', 'pg36', 'pv23', 'pr122', 'pbk']
export const isStrong = (paintId) => Boolean(paintId) && STRONG.some((s) => paintId.startsWith(s))
