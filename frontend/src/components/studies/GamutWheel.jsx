import { useId, useMemo, useRef, useState } from 'react'
import { angleOf, hexToWheel, wheelToXY, xyToWheel } from '../../lib/colorWheel'
import { moveShape, shapeContains, toUnit } from '../../lib/gamutMask'

const SIZE = 300 // viewBox units; the wheel scales to its box
const PAD = 20 // room outside the rim for the hue letters
const W = SIZE - 2 * PAD // the wheel's diameter
const C = SIZE / 2 // the centre
const RW = W / 2 // the wheel's radius
const CORNER_HIT_TOUCH = 24 // about 44px under a finger
const CORNER_HIT_MOUSE = 12
const EDGE_HIT = 8 // a circle's edge, to resize it
const GREY80 = '#cccccc'

// Kept simple, as the reference wheel: 12 hues in 9 rings of flat colour,
// thin lines between the tiles, grey at the centre.
const SECTORS = 12
const RINGS = 9
const LETTERS = [[60, 'Y'], [120, 'G'], [180, 'C'], [240, 'B'], [300, 'M'], [0, 'R']]

const wxy = (p) => wheelToXY(p, W).map((v) => v + PAD)
const svgToUnit = ([x, y]) => [(x - C) / RW, (y - C) / RW]
const unitToSvg = ([x, y]) => [C + x * RW, C + y * RW]
const polar = (r, deg) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)]

// One tile: hue sector k, ring i (0 is the centre).
function tilePath(k, i) {
  const a0 = angleOf(k * (360 / SECTORS) - 180 / SECTORS)
  const a1 = a0 + 360 / SECTORS
  const r0 = (i / RINGS) * RW, r1 = ((i + 1) / RINGS) * RW
  const [x1, y1] = polar(r1, a0), [x2, y2] = polar(r1, a1)
  if (i === 0) return `M${C} ${C}L${x1} ${y1}A${r1} ${r1} 0 0 1 ${x2} ${y2}Z`
  const [x3, y3] = polar(r0, a1), [x4, y4] = polar(r0, a0)
  return `M${x1} ${y1}A${r1} ${r1} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${r0} ${r0} 0 0 0 ${x4} ${y4}Z`
}
export const tileFill = (k, i) => `hsl(${k * (360 / SECTORS)} ${Math.round(((i + 0.5) / RINGS) * 85)}% 55%)`

// The tile under a wheel point.
export function tileAt({ h, c }) {
  if (c > 1) return null
  return { k: Math.round(h / (360 / SECTORS)) % SECTORS, i: Math.min(RINGS - 1, Math.floor(c * RINGS)) }
}
// A tile's colour as hex (for the recipe).
export function tileHex({ k, i }) {
  const el = document.createElement('canvas').getContext('2d')
  el.fillStyle = tileFill(k, i)
  return el.fillStyle
}

const shapePath = (s) => {
  if (s.type === 'circle') {
    const [cx, cy] = unitToSvg(toUnit(s.center)), r = s.r * RW
    return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`
  }
  return `M${s.corners.map((c) => wxy(c).join(' ')).join('L')}Z`
}

/**
 * The gamut mask wheel (design doc, item 37), after Krita's gamut masks.
 * The mask is one or more shapes; outside them the wheel is darkened.
 *   drag a polygon's corner    reshapes it (a hand over the corner)
 *   drag a circle's edge       resizes it
 *   drag inside a shape        moves it (a hand over it)
 *   click a tile               selects that colour (onSelect), inside the
 *                              mask or not, as Krita's selector
 * No handles or outlines: the darkening and the cursor show the shapes.
 * Paints are small squares under the darkening, guides only.
 *
 *   shapes, onChange(shapes, { done })    the mask
 *   active, onActive(index)               the shape last touched
 *   selected { h, c } | null              the selected colour, ringed
 */
export default function GamutWheel({ shapes, onChange, active, onActive, paints, selected, onSelect, readOnly = false, className = '' }) {
  const id = useId().replace(/:/g, '')
  const svgRef = useRef(null)
  // { kind: 'corner' | 'edge' | 'shape' | 'tile', index, corner, last, start, moved }
  const drag = useRef(null)
  const [cursor, setCursor] = useState('default')

  const squares = useMemo(() => paints.map((p) => ({ ...p, xy: wxy(hexToWheel(p.hex)) })), [paints])

  function toSvg(e) {
    const box = svgRef.current.getBoundingClientRect()
    return [((e.clientX - box.left) / box.width) * SIZE, ((e.clientY - box.top) / box.height) * SIZE]
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

  // What is under the pointer, topmost shape first.
  function hitAt(p, e) {
    const near = e.pointerType === 'touch' ? CORNER_HIT_TOUCH : CORNER_HIT_MOUSE
    for (let s = shapes.length - 1; s >= 0; s--) {
      const sh = shapes[s]
      if (sh.type === 'polygon') {
        const k = sh.corners.findIndex((c) => dist(p, wxy(c)) < near)
        if (k >= 0) return { kind: 'corner', index: s, corner: k }
      } else {
        const d = dist(p, unitToSvg(toUnit(sh.center)))
        if (Math.abs(d - sh.r * RW) < EDGE_HIT) return { kind: 'edge', index: s }
      }
    }
    const u = svgToUnit(p)
    for (let s = shapes.length - 1; s >= 0; s--) if (shapeContains(shapes[s], u)) return { kind: 'shape', index: s }
    return null
  }
  const cursorFor = (hit) => (!hit ? 'pointer' : hit.kind === 'edge' ? 'nwse-resize' : 'grab')

  function down(e) {
    const p = toSvg(e)
    if (dist(p, [C, C]) > RW + 4) return
    const hit = readOnly ? null : hitAt(p, e)
    drag.current = { ...(hit || { kind: 'tile' }), last: p, start: p, moved: false }
    svgRef.current.setPointerCapture(e.pointerId)
    if (hit) { onActive?.(hit.index); setCursor(hit.kind === 'edge' ? 'nwse-resize' : 'grabbing') }
  }

  function move(e) {
    const p = toSvg(e)
    const d = drag.current
    if (!d) {
      const inside = dist(p, [C, C]) <= RW
      setCursor(inside ? (readOnly ? 'pointer' : cursorFor(hitAt(p, e))) : 'default')
      return
    }
    if (d.kind === 'tile') return
    if (!d.moved && dist(p, d.start) < 3) return // still a click
    d.moved = true
    const s = shapes[d.index]
    let next = null
    if (d.kind === 'corner') {
      const w = xyToWheel(p[0] - PAD, p[1] - PAD, W)
      next = { ...s, corners: s.corners.map((c, i) => (i === d.corner ? { h: w.h, c: Math.min(1, w.c) } : c)) }
    } else if (d.kind === 'edge') {
      const cu = toUnit(s.center)
      const r = Math.max(0.04, Math.min(dist(p, unitToSvg(cu)) / RW, 1 - Math.hypot(...cu)))
      next = { ...s, r }
    } else {
      next = moveShape(s, (p[0] - d.last[0]) / RW, (p[1] - d.last[1]) / RW)
      if (next) d.last = p
    }
    if (next) onChange(shapes.map((x, i) => (i === d.index ? next : x)), { done: false })
  }

  function up(e) {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (!d.moved) {
      // A click: select the tile there.
      const p = toSvg(e)
      const w = xyToWheel(p[0] - PAD, p[1] - PAD, W)
      if (w.c <= 1) onSelect?.(w)
      setCursor(readOnly ? 'pointer' : cursorFor(hitAt(p, e)))
      return
    }
    setCursor('grab')
    onChange(shapes, { done: true })
  }

  const sel = selected ? tileAt(selected) : null

  return (
    <div className={`relative mx-auto aspect-square w-full max-w-[360px] select-none ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`absolute inset-0 h-full w-full overflow-visible ${readOnly ? '' : 'touch-none'}`}
        style={{ cursor }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { drag.current = null }}
        onPointerLeave={() => { if (!drag.current) setCursor('default') }}
        role="img"
        aria-label={`Colour wheel with a gamut mask of ${shapes.length} ${shapes.length === 1 ? 'shape' : 'shapes'}`}
      >
        <defs>
          <clipPath id={`clip-${id}`}><circle cx={C} cy={C} r={RW} /></clipPath>
          {/* The mask: white shows the darkening, the shapes cut it away. */}
          <mask id={`mask-${id}`}>
            <rect width={SIZE} height={SIZE} fill="#fff" />
            {shapes.map((s, i) => <path key={i} d={shapePath(s)} fill="#000" />)}
          </mask>
        </defs>
        {Array.from({ length: SECTORS }, (_, k) => Array.from({ length: RINGS }, (_, i) => (
          <path key={`${k}-${i}`} d={tilePath(k, i)} fill={tileFill(k, i)} stroke="rgba(0,0,0,0.28)" strokeWidth={0.6} />
        )))}
        {/* Paints: small squares, under the darkening, so they read as part of the wheel. */}
        {squares.map((d) => (
          <rect key={d.id} data-paint={d.id} x={d.xy[0] - 6.5} y={d.xy[1] - 6.5} width={13} height={13} fill={d.hex} stroke={GREY80} strokeWidth={1} />
        ))}
        <rect width={SIZE} height={SIZE} fill="rgba(0,0,0,0.68)" mask={`url(#mask-${id})`} clipPath={`url(#clip-${id})`} />
        <circle cx={C} cy={C} r={RW} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={0.8} />
        {LETTERS.map(([h, letter]) => {
          const [x, y] = polar(RW + 11, angleOf(h))
          return <text key={letter} x={x} y={y} textAnchor="middle" dominantBaseline="central" fill={GREY80} fontSize="13" fontWeight="700">{letter}</text>
        })}
        {sel && <path d={tilePath(sel.k, sel.i)} fill="none" stroke="#fff" strokeWidth={2.2} strokeLinejoin="round" />}
      </svg>
    </div>
  )
}
