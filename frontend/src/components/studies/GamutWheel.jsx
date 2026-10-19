import { useMemo, useRef, useState } from 'react'
import { angleOf, hexToWheel, moveMask, pointInPolygon, wheelToXY, xyToWheel } from '../../lib/colorWheel'

const SIZE = 300 // viewBox units; the wheel scales to its box
const PAD = 24 // room outside the rim for the hue letters
const W = SIZE - 2 * PAD // the wheel's diameter
const C = SIZE / 2 // the centre
const RW = W / 2 // the wheel's radius
const CORNER_HIT = 24 // about 44px at the wheel's usual size
const DOT_HIT = 13
const SNAP = 9 // a corner dropped this close to a paint dot sits on it
const REMOVE_AT = RW + 34 // drag a corner past the letters to remove it
export const MAX_CORNERS = 6
export const MIN_CORNERS = 3
// The starting mask: an even triad in the middle (yellow, cyan, magenta).
export const DEFAULT_MASK = [60, 180, 300].map((h) => ({ h, c: 0.6, paint_id: null }))

// Kept simple, as the reference wheel: 12 hues in 9 rings of flat colour,
// thin lines between the cells, grey at the centre.
const SECTORS = 12
const RINGS = 9
const LETTERS = [[60, 'Y'], [120, 'G'], [180, 'C'], [240, 'B'], [300, 'M'], [0, 'R']]

const wxy = (p) => wheelToXY(p, W).map((v) => v + PAD)
const xyw = (x, y) => xyToWheel(x - PAD, y - PAD, W)
const polar = (r, deg) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)]

// One cell: hue sector k, ring i (0 is the centre).
function cellPath(k, i) {
  const a0 = angleOf(k * (360 / SECTORS) - 180 / SECTORS)
  const a1 = a0 + 360 / SECTORS
  const r0 = (i / RINGS) * RW, r1 = ((i + 1) / RINGS) * RW
  const [x1, y1] = polar(r1, a0), [x2, y2] = polar(r1, a1)
  if (i === 0) return `M${C} ${C}L${x1} ${y1}A${r1} ${r1} 0 0 1 ${x2} ${y2}Z`
  const [x3, y3] = polar(r0, a1), [x4, y4] = polar(r0, a0)
  return `M${x1} ${y1}A${r1} ${r1} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${r0} ${r0} 0 0 0 ${x4} ${y4}Z`
}
const cellFill = (k, i) => `hsl(${k * (360 / SECTORS)} ${Math.round(((i + 0.5) / RINGS) * 85)}% 55%)`


/**
 * The gamut mask wheel (design doc, item 37): Tobey Sanford's Yurmby
 * wheel, the sketcher's paints as small dots, and the mask's corners.
 * The mask is a shape on the wheel (Gurney): it starts as a triangle in
 * the middle, and the sketcher shapes it.
 *   drag a corner              reshapes the mask (a hand over a corner);
 *                              it sits on a paint when dropped close
 *   drag inside the mask       moves the whole mask (a hand over it)
 *   click inside the mask      shows the mix there (onSample)
 *   drag a corner off the rim  removes it, down to 3 corners
 * No corner handles, as GamutCut: the edges and the cursor show them.
 * Paints are small squares, guides only. Outside the mask is darkened.
 *
 *   corners   [{ h, c, paint_id }]   in the order placed
 *   paints    [{ id, name, hex }]    shown as dots
 *   onChange(corners, { done })     done: false while a corner moves
 *   onFocus({ index })  the corner last pressed
 *   sample    { h, c } | null       a ring where the shown mix sits
 *   readOnly  no edits (the plan is locked)
 */
export default function GamutWheel({ corners, paints, onChange, onFocus, onSample, sample, readOnly = false, className = '' }) {
  const svgRef = useRef(null)
  // { kind: 'corner', index } or { kind: 'mask', last: [x, y] }; moved: dragged, not a click
  const drag = useRef(null)
  const [removing, setRemoving] = useState(false)
  const [cursor, setCursor] = useState('default')

  const dots = useMemo(() => paints.map((p) => {
    const w = hexToWheel(p.hex)
    return { ...p, ...w, xy: wxy(w) }
  }), [paints])
  const pts = corners.map(wxy)

  function toSvg(e) {
    const box = svgRef.current.getBoundingClientRect()
    return [((e.clientX - box.left) / box.width) * SIZE, ((e.clientY - box.top) / box.height) * SIZE]
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const nearestDot = (p, within) => {
    let best = null, bd = within
    for (const d of dots) { const dd = dist(p, d.xy); if (dd < bd) { bd = dd; best = d } }
    return best
  }
  // The corner under the pointer: a fingertip gets a bigger target.
  function cornerAt(p, e) {
    let hit = -1, hd = e.pointerType === 'touch' ? CORNER_HIT : 14
    pts.forEach((q, i) => { const d = dist(p, q); if (d < hd) { hd = d; hit = i } })
    return hit
  }
  const insideMask = (p) => pts.length >= 3 && pointInPolygon(p, pts)

  function down(e) {
    if (readOnly) return
    const p = toSvg(e)
    const hit = cornerAt(p, e)
    if (hit >= 0) {
      drag.current = { kind: 'corner', index: hit, moved: false }
    } else if (insideMask(p)) {
      drag.current = { kind: 'mask', last: p, start: p, moved: false }
    } else {
      return
    }
    svgRef.current.setPointerCapture(e.pointerId)
    setCursor('grabbing')
    onFocus?.(hit >= 0 ? { index: hit } : null)
  }

  function move(e) {
    const p = toSvg(e)
    if (!drag.current) {
      // A hand over a corner or the mask: they can be dragged.
      if (!readOnly) setCursor(cornerAt(p, e) >= 0 || insideMask(p) ? 'grab' : 'default')
      return
    }
    const d = drag.current
    if (d.kind === 'mask') {
      if (!d.moved && dist(p, d.start) < 3) return // still a click
      d.moved = true
      const next = moveMask(corners, (p[0] - d.last[0]) / RW, (p[1] - d.last[1]) / RW)
      if (next) { d.last = p; onChange(next, { done: false }) }
      return
    }
    d.moved = true
    const out = corners.length > MIN_CORNERS && dist(p, [C, C]) > REMOVE_AT
    setRemoving(out)
    const dot = !out && nearestDot(p, SNAP)
    const w = xyw(...p)
    const next = dot ? { h: dot.h, c: dot.c, paint_id: dot.id } : { h: w.h, c: Math.min(1, w.c), paint_id: null }
    onChange(corners.map((c, i) => (i === d.index ? next : c)), { done: false })
  }

  function up(e) {
    const d = drag.current
    if (!d) return
    drag.current = null
    setCursor('grab')
    if (d.kind === 'mask' && !d.moved) {
      // A click inside the mask, not a drag: the mix there.
      onSample?.(xyw(...toSvg(e)))
      return
    }
    if (d.kind === 'corner' && removing) {
      setRemoving(false)
      onChange(corners.filter((_, i) => i !== d.index), { done: true })
      onFocus?.(null)
      return
    }
    onChange(corners, { done: true })
  }

  // Everything outside the mask is darkened, so the gamut stands out.
  const veil = pts.length >= 3
    ? `M0 0H${SIZE}V${SIZE}H0Z M${pts.map((q) => q.join(' ')).join(' L')} Z`
    : null
  const sampleXY = sample ? wxy(sample) : null
  const removingIndex = removing && drag.current?.kind === 'corner' ? drag.current.index : -1

  return (
    <div className={`relative mx-auto aspect-square w-full max-w-[320px] select-none ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`absolute inset-0 h-full w-full overflow-visible ${readOnly ? '' : 'touch-none'}`}
        style={{ cursor: readOnly ? 'default' : cursor }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => { if (!drag.current) setCursor('default') }}
        role="img"
        aria-label={`Colour wheel with a ${corners.length}-corner mask`}
      >
        <defs>
          <clipPath id="wheel-clip"><circle cx={C} cy={C} r={RW} /></clipPath>
        </defs>
        <g aria-hidden="true">
          {Array.from({ length: SECTORS }, (_, k) => Array.from({ length: RINGS }, (_, i) => (
            <path key={`${k}-${i}`} d={cellPath(k, i)} fill={cellFill(k, i)} stroke="rgba(0,0,0,0.28)" strokeWidth={0.6} />
          )))}
          <circle cx={C} cy={C} r={RW} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={0.8} />
          {LETTERS.map(([h, letter]) => {
            const [x, y] = polar(RW + 13, angleOf(h))
            return <text key={letter} x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="14" fontWeight="700">{letter}</text>
          })}
        </g>
        {veil && <path d={veil} fillRule="evenodd" fill="rgba(0,0,0,0.68)" clipPath="url(#wheel-clip)" pointerEvents="none" />}
        {/* Paints: small squares, so they read apart from the mask. */}
        {dots.map((d) => (
          <rect key={d.id} data-paint={d.id} pointerEvents="none" x={d.xy[0] - 6.5} y={d.xy[1] - 6.5} width={13} height={13}
            fill={d.hex} stroke="#fff" strokeWidth={1} />
        ))}
        {pts.length >= 2 && (
          <polygon points={pts.map((q) => q.join(',')).join(' ')} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={1.2}
            strokeLinejoin="round" pointerEvents="none" />
        )}
        {removingIndex >= 0 && (
          <circle cx={pts[removingIndex][0]} cy={pts[removingIndex][1]} r={10} fill="none" stroke="#fff" strokeDasharray="3 3" />
        )}
        {sampleXY && <circle cx={sampleXY[0]} cy={sampleXY[1]} r={9} fill="none" stroke="#fff" strokeWidth={2.5} strokeDasharray="3 3" pointerEvents="none" />}
      </svg>
    </div>
  )
}
