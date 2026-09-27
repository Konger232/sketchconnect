import { useEffect, useRef, useState } from 'react'
import Button from '../common/Button'

/**
 * Planning marks: freehand lines the sketcher draws over their framed photo
 * (big shapes, a horizon, lines to follow) after marking focal points.
 *
 * Marks are stored as data, never baked into reference_image_url, so the
 * scene-analysis call still sees a clean photo. Each mark is
 *   { color: '#rrggbb', width: <frame units>, points: [[x, y], ...] }
 * with x/y in the same 0-1000 frame space as focal_points. `width` is in
 * frame units (px on a 1000px-wide frame), so a line keeps the same weight
 * relative to the photo on any screen.
 *
 * Three pieces:
 *   - useMarkDrawing: pointer handling + the marks list (CreateSketch)
 *   - MarksLayer: an SVG <g> that renders marks inside any 0-1000 viewBox
 *     overlay (CreateSketch while drawing, EditSketch's framed slide)
 *   - MarkPanel (default): the right-panel controls
 */

export const MARK_COLORS = [
  { value: '#ffffff', label: 'White' },
  { value: '#ffd400', label: 'Yellow' },
  { value: '#00c8ff', label: 'Blue' },
  { value: '#ff073a', label: 'Red' },
  { value: '#111111', label: 'Black' },
]

export const MARK_WIDTHS = [
  { value: 3, label: 'Fine' },
  { value: 6, label: 'Medium' },
  { value: 12, label: 'Bold' },
]

// Minimum distance (frame units) between kept points -- keeps the saved
// JSON small without visibly changing the line.
const MIN_STEP = 2.5

const round1 = (n) => Math.round(n * 10) / 10
const clamp = (n) => Math.min(1000, Math.max(0, n))

// Screen px per frame unit, from the enclosing <svg>'s rendered width.
// Same idea as Reticle's aspect measurement in FocalSpotPicker.jsx.
function useSvgScale(ref) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const svg = ref.current?.ownerSVGElement
    if (!svg) return
    const measure = () => {
      const r = svg.getBoundingClientRect()
      if (r.width) setScale(r.width / 1000)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [ref])
  return scale
}

export function MarksLayer({ marks = [], live = null }) {
  const gRef = useRef(null)
  const scale = useSvgScale(gRef)
  const all = live ? [...marks, live] : marks

  return (
    <g ref={gRef} className="pointer-events-none">
      {all.map((m, i) => {
        if (!m?.points?.length) return null
        // A single tap still leaves a visible dot.
        const pts = m.points.length > 1 ? m.points : [m.points[0], [m.points[0][0] + 0.01, m.points[0][1]]]
        return (
          <polyline
            key={i}
            points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
            fill="none"
            stroke={m.color}
            strokeWidth={m.width * scale}
            strokeLinecap="round"
            strokeLinejoin="round"
            // The overlay stretches its viewBox independently in x and y
            // (preserveAspectRatio="none"); this keeps the line an even width.
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </g>
  )
}

/**
 * Pointer handlers go on the element that receives the gestures (ImagePanel's
 * container); positions are measured against svgRef, the 0-1000 overlay.
 */
export function useMarkDrawing(svgRef, { color, width, enabled }) {
  const [marks, setMarks] = useState([])
  const [live, setLive] = useState(null)
  const liveRef = useRef(null) // { mark, pointerId }

  function toFrame(e) {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return null
    return [((e.clientX - r.left) / r.width) * 1000, ((e.clientY - r.top) / r.height) * 1000]
  }

  function onPointerDown(e) {
    if (!enabled || liveRef.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const p = toFrame(e)
    // Ignore presses on the panel's padding, outside the photo.
    if (!p || p[0] < 0 || p[0] > 1000 || p[1] < 0 || p[1] > 1000) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const mark = { color, width, points: [p.map(round1)] }
    liveRef.current = { mark, pointerId: e.pointerId }
    setLive({ ...mark })
  }

  function onPointerMove(e) {
    const cur = liveRef.current
    if (!cur || e.pointerId !== cur.pointerId) return
    const coalesced = e.nativeEvent?.getCoalescedEvents?.()
    const events = coalesced?.length ? coalesced : [e]
    const pts = cur.mark.points
    let added = false
    for (const ev of events) {
      const p = toFrame(ev)
      if (!p) continue
      const last = pts[pts.length - 1]
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= MIN_STEP) {
        pts.push([round1(clamp(p[0])), round1(clamp(p[1]))])
        added = true
      }
    }
    if (added) setLive({ ...cur.mark, points: [...pts] })
  }

  function onPointerUp(e) {
    const cur = liveRef.current
    if (!cur || e.pointerId !== cur.pointerId) return
    liveRef.current = null
    setLive(null)
    setMarks((prev) => [...prev, cur.mark])
  }

  return {
    marks,
    live,
    setMarks,
    undo: () => setMarks((prev) => prev.slice(0, -1)),
    clear: () => setMarks([]),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  }
}

export default function MarkPanel({
  color,
  onColorChange,
  width,
  onWidthChange,
  count,
  onUndo,
  onClear,
  onBack,
  onSkip,
  onContinue,
  saving,
  error,
}) {
  const isPreset = MARK_COLORS.some((c) => c.value === color)

  return (
    <div className="animate-fade-in-up flex flex-col gap-5">
      <div>
        <h2 className="panel-label text-sm text-white/80">Add planning marks</h2>
        <p className="mt-2 text-xs text-white/60">
          Optional. Sketch guides on your frame: big shapes, a horizon, the lines you'll follow. Your coach sees
          them later.
        </p>
      </div>

      {/* --- Colour --- */}
      <div className="flex flex-col gap-2">
        <span className="panel-label" id="mark-color-label">Colour</span>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="mark-color-label">
          {MARK_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-label={c.label}
              aria-pressed={color === c.value}
              onClick={() => onColorChange(c.value)}
              className={`h-7 w-7 rounded-full border-2 ring-1 ring-inset ring-white/25 ${
                color === c.value ? 'border-white' : 'border-transparent'
              }`}
              style={{ background: c.value }}
            />
          ))}
          {/* Any other colour: the browser's own picker, no library. */}
          <label
            title="Pick any colour"
            className={`relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border-2 ring-1 ring-inset ring-white/25 ${
              isPreset ? 'border-transparent' : 'border-white'
            }`}
            style={{
              background: isPreset
                ? 'conic-gradient(#ff073a, #ffd400, #39ff14, #00c8ff, #7a5cff, #ff073a)'
                : color,
            }}
          >
            <input
              id="mark-custom-color"
              type="color"
              aria-label="Custom colour"
              value={isPreset ? '#39ff14' : color}
              onChange={(e) => onColorChange(e.target.value)}
              className="absolute -inset-2 h-12 w-12 cursor-pointer opacity-0"
            />
          </label>
        </div>
      </div>

      {/* --- Line thickness --- */}
      <div className="flex flex-col gap-2">
        <span className="panel-label" id="mark-width-label">Line thickness</span>
        <div className="flex gap-2" role="group" aria-labelledby="mark-width-label">
          {MARK_WIDTHS.map((w) => (
            <button
              key={w.value}
              type="button"
              aria-pressed={width === w.value}
              onClick={() => onWidthChange(w.value)}
              className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-1.5 py-2.5 text-2xs font-medium transition-colors ${
                width === w.value ? 'border-white/40 bg-gray-800 text-white/90' : 'border-white/15 text-white/50 hover:bg-white/5'
              }`}
            >
              <span className="block w-8 rounded-full" style={{ height: `${Math.max(2, w.value * 0.6)}px`, background: color }} />
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* --- Undo / clear --- */}
      <div className="flex items-center gap-4">
        <Button variant="linkOnDark" onClick={onUndo} disabled={count === 0 || saving} className="font-medium disabled:opacity-40">
          Undo
        </Button>
        <Button variant="linkOnDark" onClick={onClear} disabled={count === 0 || saving} className="font-medium disabled:opacity-40">
          Clear all
        </Button>
        <span className="text-xs tabular-nums text-white/40">
          {count === 1 ? '1 mark' : `${count} marks`}
        </span>
      </div>

      {/* --- Navigation --- */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="linkOnDark" onClick={onBack} disabled={saving} className="font-medium">
          Back
        </Button>
        <Button variant="linkOnDark" onClick={onSkip} disabled={saving} className="font-medium">
          Skip this step
        </Button>
        <Button variant="primaryOnDark" size="sm" onClick={onContinue} disabled={saving}>
          {saving ? 'Saving…' : 'Continue'}
        </Button>
      </div>

      {error && <p className="text-sm text-accent">{error}</p>}
    </div>
  )
}
