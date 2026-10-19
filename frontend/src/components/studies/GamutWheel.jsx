import { useMemo, useRef, useState } from 'react'
import { angleOf, hexToWheel, pointInPolygon, wheelToXY, xyToWheel } from '../../lib/colorWheel'

const SIZE = 300 // viewBox units; the wheel scales to its box
const PAD = 24 // room outside the rim for the hue letters
const W = SIZE - 2 * PAD // the wheel's diameter
const C = SIZE / 2 // the centre
const RW = W / 2 // the wheel's radius
const CORNER_HIT = 24 // about 44px at the wheel's usual size
const DOT_HIT = 13
const SNAP = 15
const REMOVE_AT = RW + 34 // drag a corner past the letters to remove it
export const MAX_CORNERS = 6

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

// A free corner snaps to the centre of the cell it falls in.
function snapToCell({ h, c }) {
  const k = Math.round(h / (360 / SECTORS)) % SECTORS
  const i = Math.min(RINGS - 1, Math.floor(Math.min(1, c) * RINGS))
  return { h: k * (360 / SECTORS), c: (i + 0.5) / RINGS }
}

/**
 * The gamut mask wheel (design doc, item 37): Tobey Sanford's Yurmby
 * wheel, the sketcher's paints as small dots, and the mask's corners.
 * One finger, nothing to learn:
 *   tap a paint dot            it becomes a corner
 *   tap empty wheel            a free corner (outside the mask)
 *   tap inside the mask        shows the mix there (onSample)
 *   drag a corner              moves it; it snaps to a paint dot nearby
 *   drag a corner off the rim  removes it; the others reconnect
 *
 *   corners   [{ h, c, paint_id }]   in the order placed
 *   paints    [{ id, name, hex }]    shown as dots
 *   onChange(corners, { done })     done: false while a corner moves
 *   onFocus(item)  the paint or corner last touched, for its label
 *   sample    { h, c } | null       a ring where the shown mix sits
 *   readOnly  no edits (the plan is locked)
 */
export default function GamutWheel({ corners, paints, onChange, onFocus, onSample, sample, readOnly = false, className = '' }) {
  const svgRef = useRef(null)
  const drag = useRef(null) // { index, moved }
  const [removing, setRemoving] = useState(false)
  const [full, setFull] = useState(false)

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
    const hit = pts.findIndex((q) => dist(p, q) < CORNER_HIT)
    if (hit >= 0) {
      drag.current = { index: hit, moved: false }
      svgRef.current.setPointerCapture(e.pointerId)
      const c = corners[hit]
      onFocus?.(c.paint_id ? { paint: paints.find((x) => x.id === c.paint_id) } : { corner: c })
      return
    }
    const dot = nearestDot(p, DOT_HIT)
    if (dot) {
      onFocus?.({ paint: dot })
      if (corners.some((c) => c.paint_id === dot.id)) return
      if (corners.length >= MAX_CORNERS) return setFull(true)
      onChange([...corners, { h: dot.h, c: dot.c, paint_id: dot.id }], { done: true })
      return
    }
    if (pts.length >= 3 && pointInPolygon(p, pts)) {
      onSample?.(xyw(...p))
      return
    }
    if (dist(p, [C, C]) > RW + 2) return
    if (corners.length >= MAX_CORNERS) return setFull(true)
    // A free corner, which can be dragged on straight away.
    const w = snapToCell(xyw(...p))
    onChange([...corners, { ...w, paint_id: null }], { done: false })
    drag.current = { index: corners.length, moved: true }
    svgRef.current.setPointerCapture(e.pointerId)
    onFocus?.({ corner: w })
  }

  function move(e) {
    if (!drag.current) return
    const p = toSvg(e)
    drag.current.moved = true
    const out = dist(p, [C, C]) > REMOVE_AT
    setRemoving(out)
    const dot = !out && nearestDot(p, SNAP)
    const next = dot ? { h: dot.h, c: dot.c, paint_id: dot.id } : { ...snapToCell(xyw(...p)), paint_id: null }
    onChange(corners.map((c, i) => (i === drag.current.index ? next : c)), { done: false })
  }

  function up() {
    if (!drag.current) return
    const { index } = drag.current
    drag.current = null
    if (removing) {
      setRemoving(false)
      setFull(false)
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
        {veil && <path d={veil} fillRule="evenodd" fill="rgba(10,12,20,0.6)" clipPath="url(#wheel-clip)" />}
        {dots.map((d) => (
          <g key={d.id} data-paint={d.id}>
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
      {full && <p className="absolute -bottom-6 inset-x-0 text-center text-sm text-sc-text3">Up to {MAX_CORNERS} corners.</p>}
    </div>
  )
}
