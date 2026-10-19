import { useEffect, useMemo, useRef, useState } from 'react'
import { hslToRgb, hexToWheel, pointInPolygon, wheelToXY, xyToWheel } from '../../lib/colorWheel'

const SIZE = 300 // viewBox units; the wheel scales to its box
const R = SIZE / 2
const CORNER_HIT = 24 // about 44px at the wheel's usual size
const DOT_HIT = 13
const SNAP = 15
const REMOVE_AT = R + 18 // drag a corner this far out to remove it
export const MAX_CORNERS = 6

// The wheel's colours, painted once: hue by angle, intensity by distance.
function paintWheel(canvas) {
  const px = canvas.width
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(px, px)
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const { h, c } = xyToWheel((x + 0.5) * (SIZE / px), (y + 0.5) * (SIZE / px), SIZE)
      if (c > 1.004) continue
      const [r, g, b] = hslToRgb(h, Math.min(1, c), 0.5)
      const i = (y * px + x) * 4
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
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
  const canvasRef = useRef(null)
  const svgRef = useRef(null)
  const drag = useRef(null) // { index, moved }
  const [removing, setRemoving] = useState(false)
  const [full, setFull] = useState(false)

  useEffect(() => { if (canvasRef.current) paintWheel(canvasRef.current) }, [])

  const dots = useMemo(() => paints.map((p) => {
    const w = hexToWheel(p.hex)
    return { ...p, ...w, xy: wheelToXY(w, SIZE) }
  }), [paints])
  const pts = corners.map((c) => wheelToXY(c, SIZE))

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
      onSample?.(xyToWheel(...p, SIZE))
      return
    }
    if (dist(p, [R, R]) > R + 2) return
    if (corners.length >= MAX_CORNERS) return setFull(true)
    // A free corner, which can be dragged on straight away.
    const w = xyToWheel(...p, SIZE)
    onChange([...corners, { h: w.h, c: Math.min(1, w.c), paint_id: null }], { done: false })
    drag.current = { index: corners.length, moved: true }
    svgRef.current.setPointerCapture(e.pointerId)
    onFocus?.({ corner: w })
  }

  function move(e) {
    if (!drag.current) return
    const p = toSvg(e)
    drag.current.moved = true
    const out = dist(p, [R, R]) > REMOVE_AT
    setRemoving(out)
    const dot = !out && nearestDot(p, SNAP)
    const w = xyToWheel(...p, SIZE)
    const next = dot ? { h: dot.h, c: dot.c, paint_id: dot.id } : { h: w.h, c: Math.min(1, w.c), paint_id: null }
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
  const sampleXY = sample ? wheelToXY(sample, SIZE) : null

  return (
    <div className={`relative mx-auto aspect-square w-full max-w-[320px] select-none ${className}`}>
      <canvas ref={canvasRef} width={480} height={480} className="absolute inset-0 h-full w-full rounded-full" aria-hidden="true" />
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
          <clipPath id="wheel-clip"><circle cx={R} cy={R} r={R} /></clipPath>
        </defs>
        {veil && <path d={veil} fillRule="evenodd" fill="rgba(10,12,20,0.62)" clipPath="url(#wheel-clip)" />}
        <circle cx={R} cy={R} r={R - 0.5} fill="none" stroke="rgba(255,255,255,0.25)" />
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
