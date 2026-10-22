// My palette's pans, laid out like the sketcher's tin (design doc, item 45).
//
//   { rows, cols, pans: [{ r, c, w, h, paint }] }
//
// Every cell is an empty half pan unless a pan entry covers it. A full pan
// takes two cells: side by side (w 2) or one above the other (h 2). The
// backend checks the same rules (profile/router.py, clean_palette_layout).
import { PAINTS } from '../data/paints'
import { angleOf, paintToWheel } from './colorWheel'

export const DEFAULT_ROWS = 2
export const DEFAULT_COLS = 6
export const MAX_ROWS = 6
export const MAX_COLS = 12

const cellsOf = (p) => {
  const out = []
  for (let i = 0; i < p.h; i++) for (let j = 0; j < p.w; j++) out.push([p.r + i, p.c + j])
  return out
}

// The pan covering a cell, or null for an empty half pan.
export const panAt = (layout, r, c) => layout.pans.find((p) => cellsOf(p).some(([a, b]) => a === r && b === c)) || null

// Every pan to draw, empty half pans included, top left first.
export function allPans(layout) {
  const out = [...layout.pans]
  for (let r = 0; r < layout.rows; r++) for (let c = 0; c < layout.cols; c++) {
    if (!panAt(layout, r, c)) out.push({ r, c, w: 1, h: 1, paint: null })
  }
  return out.sort((a, b) => a.r - b.r || a.c - b.c)
}

// Empty half pan entries are the default; drop them.
const tidy = (layout, pans) => ({ ...layout, pans: pans.filter((p) => p.paint || p.w * p.h > 1) })

// The paints, in order, one per half pan, as a first layout.
export function defaultLayout(paints) {
  const cols = DEFAULT_COLS
  const rows = Math.min(MAX_ROWS, Math.max(DEFAULT_ROWS, Math.ceil(paints.length / cols)))
  return { rows, cols, pans: paints.slice(0, rows * cols).map((paint, i) => ({ r: Math.floor(i / cols), c: i % cols, w: 1, h: 1, paint })) }
}

// The first cell with no pan, or null when the tin is full.
export function firstFree(layout) {
  for (let r = 0; r < layout.rows; r++) for (let c = 0; c < layout.cols; c++) if (!panAt(layout, r, c)) return { r, c }
  return null
}

// Put a paint in the pan at a cell (a new half pan when the cell is empty).
// From another pan, the two paints swap. From the wheel or a chip, the
// paint moves: a paint sits in one pan.
export function placePaint(layout, { r, c }, paint, from = null) {
  if (!from) {
    const was = layout.pans.find((p) => p.paint === paint)
    if (was) return placePaint(layout, { r, c }, paint, { r: was.r, c: was.c })
  }
  const target = panAt(layout, r, c)
  const source = from ? panAt(layout, from.r, from.c) : null
  if (source && target === source) return layout
  const was = target?.paint || null
  let pans = layout.pans.map((p) => {
    if (p === target) return { ...p, paint }
    if (p === source) return { ...p, paint: was }
    return p
  })
  if (!target) pans = [...pans, { r, c, w: 1, h: 1, paint }]
  return tidy(layout, pans)
}

export const emptyPan = (layout, pan) => tidy(layout, layout.pans.map((p) => (p === pan ? { ...p, paint: null } : p)))

// Can this half pan become a full pan to the right ('right') or below ('down')?
export function canMerge(layout, pan, dir) {
  if (!pan || pan.w * pan.h > 1) return false
  const [r, c] = dir === 'right' ? [pan.r, pan.c + 1] : [pan.r + 1, pan.c]
  if (r >= layout.rows || c >= layout.cols) return false
  return !panAt(layout, r, c) // only an empty half pan can be taken
}

export function mergePan(layout, pan, dir) {
  const full = { ...pan, w: dir === 'right' ? 2 : 1, h: dir === 'down' ? 2 : 1 }
  const pans = layout.pans.filter((p) => p !== pan && !(p.r === pan.r && p.c === pan.c))
  return tidy(layout, [...pans, full])
}

export const splitPan = (layout, pan) => tidy(layout, layout.pans.map((p) => (p === pan ? { ...p, w: 1, h: 1 } : p)))

// A smaller tin drops the pans that no longer fit (their paints stay in
// the palette, just not in a pan).
export function resize(layout, rows, cols) {
  rows = Math.max(1, Math.min(MAX_ROWS, rows))
  cols = Math.max(1, Math.min(MAX_COLS, cols))
  return { rows, cols, pans: layout.pans.filter((p) => p.r + p.h <= rows && p.c + p.w <= cols) }
}

// A paint taken out of the palette, or swapped for another.
export const dropPaint = (layout, paint) => tidy(layout, layout.pans.map((p) => (p.paint === paint ? { ...p, paint: null } : p)))
export const swapPaint = (layout, was, now) => ({ ...layout, pans: layout.pans.map((p) => (p.paint === was ? { ...p, paint: now } : p)) })

export const placed = (layout) => new Set(layout.pans.map((p) => p.paint).filter(Boolean))

// ---- nearest paints on the wheel ----

const unit = ({ h, c }) => {
  const a = (angleOf(h) * Math.PI) / 180
  return [c * Math.cos(a), c * Math.sin(a)]
}

// Our paints, nearest to a point on the wheel first.
export function nearestPaints(at) {
  const [x, y] = unit(at)
  return PAINTS
    .map((p) => { const [px, py] = unit(paintToWheel(p.hex)); return { p, d: Math.hypot(px - x, py - y) } })
    .sort((a, b) => a.d - b.d)
    .map((e) => e.p)
}
