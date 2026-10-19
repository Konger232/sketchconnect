import { useMemo, useRef, useState } from 'react'
import { angleOf, hexToWheel, pointInPolygon, wheelToXY, xyToWheel } from '../../lib/colorWheel'

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
 *   press and drag a corner    moves it anywhere (mouse or finger); it
 *                              sits on a paint dot when dropped close
 *   drag a corner off the rim  removes it, down to 3 corners
 *   tap inside the mask        shows the mix there (onSample)
 * Paint dots are guides, not controls. Outside the mask is greyed out.
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
  const drag = useRef(null) // { index, moved }
  const [removing, setRemoving] = useState(false)

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

  function down(e) {
    if (readOnly) return
    const p = toSvg(e)
    // Press a corner to move it (the nearest one under the finger).
    let hit = -1, hd = CORNER_HIT
    pts.forEach((q, i) => { const d = dist(p, q); if (d < hd) { hd = d; hit = i } })
    if (hit >= 0) {
      drag.current = { index: hit, moved: false }
      svgRef.current.setPointerCapture(e.pointerId)
      onFocus?.({ index: hit })
      return
    }
    // Inside the mask: the mix there.
    if (pts.length >= 3 && pointInPolygon(p, pts)) onSample?.(xyw(...p))
  }

  function move(e) {
    if (!drag.current) return
    const p = toSvg(e)
    drag.current.moved = true
    const out = corners.length > MIN_CORNERS && dist(p, [C, C]) > REMOVE_AT
    setRemoving(out)
    const dot = !out && nearestDot(p, SNAP)
    const w = xyw(...p)
    const next = dot ? { h: dot.h, c: dot.c, paint_id: dot.id } : { h: w.h, c: Math.min(1, w.c), paint_id: null }
    onChange(corners.map((c, i) => (i === drag.current.index ? next : c)), { done: false })
  }

  function up() {
    if (!drag.current) return
    const { index } = drag.current
    drag.current = null
    if (removing) {
      setRemoving(false)
      onChange(corners.filter((_, i) => i !== index), { done: true })
      onFocus?.(null)
      return
    }
    onChange(corners, { done: true })
  }

  // Everything outside the mask is veiled, so the gamut stands out.
  const veil = pts.length >= 3
    ? `M0 0H${SIZE}V${SIZE}H0Z M${pts.map((q) => q.join(' ')).join(' L')} Z`
    : null
  const sampleXY = sample ? wxy(sample) : null

  return (
    <div className={`relative mx-auto aspect-square w-full max-w-[320px] select-none ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`absolute inset-0 h-full w-full overflow-visible ${readOnly ? '' : 'touch-none cursor-pointer'}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="img"
        aria-label={`Colour wheel with ${corners.length} mask corners`}
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
        {veil && <path d={veil} fillRule="evenodd" fill="rgba(150,150,150,0.62)" clipPath="url(#wheel-clip)" />}
        {dots.map((d) => (
          <g key={d.id} data-paint={d.id} pointerEvents="none">
            <circle cx={d.xy[0]} cy={d.xy[1]} r={8} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={1.5} />
            <circle cx={d.xy[0]} cy={d.xy[1]} r={6.5} fill={d.hex} stroke="#fff" strokeWidth={1.8} />
          </g>
        ))}
        {pts.length >= 2 && (
          <polygon points={pts.map((q) => q.join(',')).join(' ')} fill="none" stroke="#fff" strokeWidth={2} strokeLinejoin="round" />
        )}
        {sampleXY && <circle cx={sampleXY[0]} cy={sampleXY[1]} r={9} fill="none" stroke="#fff" strokeWidth={2.5} strokeDasharray="3 3" />}
        {corners.map((c, i) => {
          const [x, y] = pts[i]
          const fill = c.paint_id ? paints.find((p) => p.id === c.paint_id)?.hex : null
          const fading = removing && drag.current?.index === i
          return (
            <g key={i} opacity={fading ? 0.35 : 1}>
              <circle cx={x} cy={y} r={11} fill={fill || `hsl(${c.h} ${Math.round(c.c * 100)}% 50%)`} stroke="#fff" strokeWidth={3} />
              {!readOnly && <circle cx={x} cy={y} r={CORNER_HIT} fill="transparent" />}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
