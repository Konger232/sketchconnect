import { useEffect, useRef, useState } from 'react'
import Icon from '../common/Icon'
import { markGroups, squareScale } from '../../lib/markGeometry'

/**
 * Marks: freehand lines the sketcher draws over their framed photo
 * (big shapes, a horizon, lines to follow) after marking focal points.
 *
 * Marks are stored as data, never baked into reference_image_url, so the
 * scene-analysis call still sees a clean photo. Each mark is
 *   { id: 'm7', color: '#rrggbb', width: <frame units>, size_mm: 1,
 *     points: [[x, y], ...], started_ms, duration_ms,
 *     erased: false, erased_ms, selected: false }
 * with x/y in the same 0-1000 frame space as focal_points. `width` is in
 * frame units (px on a 1000px-wide frame), so a line keeps the same weight
 * relative to the photo on any screen.
 *
 * Process data (design doc, marks enhancement):
 *   - id: stable, never reused within a sketch, so anything that points at
 *     a mark (a guided question, a stored answer) still means the same mark
 *     after others are erased. The list order is the stroke order.
 *   - started_ms / duration_ms: when the stroke began, counted from the
 *     moment the Marks step first opened, and how long it took.
 *   - erased: the Eraser keeps the mark as data and hides it, so the
 *     critique can see where the sketcher changed their mind. erased_ms is
 *     when. Undo removes a stroke entirely (a slip, not a revision).
 *   - selected: the sketcher's focus. The Select tool sets it.
 *
 * Three pieces:
 *   - useMarkDrawing: pointer handling + the marks list (CreateSketch).
 *     Tool 'pen' draws, 'select' selects, 'eraser' erases the mark under
 *     the tap.
 *   - MarksLayer: an SVG <g> that renders visible marks inside any 0-1000
 *     viewBox overlay (CreateSketch, GuideStage), with a halo under
 *     selected marks
 *   - MarkPanel (default): the Marks step controls: Pen, Select, Eraser,
 *     Undo, line size (0.5 / 1 / 2) and the B&W photo toggle
 */

// Every new mark uses the --mark-color token and one of the --mark-size-*
// tokens (index.css). The colour is stored as a hex value with the mark
// (composite.py draws it). The size is stored as size_mm, and the width is
// converted to frame units when the stroke starts.
function markToken(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// The line sizes in the Marks panel, in order. Each reads its value from
// its token, e.g. --mark-size-fine: 0.5mm.
export const MARK_SIZES = [
  { key: 'fine', token: '--mark-size-fine', fallback: '0.5mm' },
  { key: 'medium', token: '--mark-size-medium', fallback: '1mm' },
  { key: 'bold', token: '--mark-size-bold', fallback: '2mm' },
]
export const DEFAULT_MARK_SIZE = 'medium'

// A size token in mm (or px), as { mm, px }. CSS has 96 px per inch.
function sizeFromToken(key) {
  const size = MARK_SIZES.find((s) => s.key === key) || MARK_SIZES[1]
  const raw = markToken(size.token, size.fallback)
  const n = parseFloat(raw)
  const px = raw.endsWith('px') ? n : (n * 96) / 25.4
  const mm = raw.endsWith('px') ? (n * 25.4) / 96 : n
  return { mm: Math.round(mm * 100) / 100, px }
}

// How close (frame units) a tap has to be to a mark for Select and Eraser.
const HIT_REACH = 25

// Minimum distance (frame units) between kept points -- keeps the saved
// JSON small without visibly changing the line.
const MIN_STEP = 2.5

const round1 = (n) => Math.round(n * 10) / 10
const clamp = (n) => Math.min(1000, Math.max(0, n))

export const isVisibleMark = (m) => Boolean(m?.points?.length) && !m.erased

// The last-drawn visible mark with a point within HIT_REACH of p, or null.
// p is in frame units; the distance is measured in square units, using the
// frame's aspect (width / height; lib/markGeometry.js squareScale). Used by
// Select and Eraser here and by EditSketch.
export function markAtPoint(marks, p, aspect = 1) {
  const [sx, sy] = squareScale(aspect)
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]
    if (isVisibleMark(m) && m.points.some((q) => Math.hypot((q[0] - p[0]) * sx, (q[1] - p[1]) * sy) <= HIT_REACH)) return m
  }
  return null
}

/**
 * The Select tool's tap cycle, as a new marks list. An unselected mark ->
 * select it. A selected mark whose shape (markGroups) has other marks not
 * yet selected -> select the whole shape. Otherwise -> clear the whole
 * shape. Shared by the Marks step and Edit's Plan photo (GuideStage).
 */
export function cycleSelection(marks, hitId, aspect = 1) {
  const hit = marks.find((m) => m.id === hitId)
  if (!hit) return marks
  const shape = markGroups(marks, aspect).get(hit.id) || [hit.id]
  const byId = new Map(marks.map((m) => [m.id, m]))
  let ids
  let value
  if (!hit.selected) {
    ids = [hit.id]
    value = true
  } else if (shape.length > 1 && shape.some((id) => !byId.get(id)?.selected)) {
    ids = shape
    value = true
  } else {
    ids = shape
    value = false
  }
  const set = new Set(ids)
  return marks.map((m) => (set.has(m.id) ? { ...m, selected: value } : m))
}

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

// A single tap still leaves a visible dot.
function polylinePoints(m) {
  const pts = m.points.length > 1 ? m.points : [m.points[0], [m.points[0][0] + 0.01, m.points[0][1]]]
  return pts.map((p) => `${p[0]},${p[1]}`).join(' ')
}

export function MarksLayer({ marks = [], live = null, highlight = [] }) {
  const gRef = useRef(null)
  const scale = useSvgScale(gRef)
  const visible = (live ? [...marks, live] : marks).filter(isVisibleMark)
  // While a guided question points at marks (highlight), every other mark
  // fades. Otherwise, while any mark is selected, the others fade
  // (--mark-dim-opacity).
  const anySelected = visible.some((m) => m.selected)
  const lit = new Set(highlight)
  const dimmed = (m) => (lit.size ? !lit.has(m.id) : anySelected && !m.selected)

  return (
    <g ref={gRef} className="pointer-events-none">
      {/* Halos first, so every mark draws on top of every halo. Colour,
          width and opacity come from the --mark-select-* tokens, and the
          fade of unselected marks from --mark-dim-opacity. */}
      {visible.filter((m) => m.selected).map((m, i) => (
        <polyline
          key={`halo-${m.id ?? i}`}
          className="mark-select-halo"
          points={polylinePoints(m)}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ strokeWidth: `calc(${m.width * scale}px + 2 * var(--mark-select-halo-width))` }}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {visible.map((m, i) => (
        <polyline
          key={m.id ?? i}
          className={dimmed(m) ? 'mark-dim' : undefined}
          points={polylinePoints(m)}
          fill="none"
          stroke={m.color}
          strokeWidth={m.width * scale}
          strokeLinecap="round"
          strokeLinejoin="round"
          // The overlay stretches its viewBox independently in x and y
          // (preserveAspectRatio="none"); this keeps the line an even width.
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  )
}

// The next free id number: one past the highest mN already in the list.
function nextIdAfter(marks) {
  let n = 0
  for (const m of marks) {
    const k = /^m(\d+)$/.exec(m.id || '')
    if (k) n = Math.max(n, Number(k[1]))
  }
  return n + 1
}

/**
 * Pointer handlers go on the element that receives the gestures (ImagePanel's
 * container); positions are measured against svgRef, the 0-1000 overlay.
 */
export function useMarkDrawing(svgRef, { enabled, tool = 'pen', size = DEFAULT_MARK_SIZE }) {
  const [marks, setMarksState] = useState([])
  const [live, setLive] = useState(null)
  const liveRef = useRef(null) // { mark, pointerId }
  const marksRef = useRef(marks)
  marksRef.current = marks
  // Undo history: { type: 'draw' | 'erase', id }, newest last.
  const [history, setHistory] = useState([])
  const nextIdRef = useRef(1)
  // performance.now() when the Marks step first opened; stroke times
  // count from here.
  const startRef = useRef(null)

  useEffect(() => {
    if (enabled && startRef.current == null) startRef.current = performance.now()
  }, [enabled])

  const elapsed = () => Math.round(performance.now() - (startRef.current ?? performance.now()))

  function setMarks(next) {
    setMarksState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      nextIdRef.current = Math.max(nextIdRef.current, nextIdAfter(value))
      return value
    })
  }

  function toFrame(e) {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return null
    return [((e.clientX - r.left) / r.width) * 1000, ((e.clientY - r.top) / r.height) * 1000]
  }

  // The frame's width / height, from the overlay as drawn: distances are
  // measured in square units (lib/markGeometry.js).
  function frameAspect() {
    const r = svgRef.current?.getBoundingClientRect()
    return r && r.width && r.height ? r.width / r.height : 1
  }

  const markAt = (p) => markAtPoint(marksRef.current, p, frameAspect())

  function eraseAt(p) {
    const hit = markAt(p)
    if (!hit) return
    const at = elapsed()
    setMarks((prev) => prev.map((m) => (m.id === hit.id ? { ...m, erased: true, erased_ms: at, selected: false } : m)))
    setHistory((h) => [...h, { type: 'erase', id: hit.id }])
  }

  function selectAt(p) {
    const hit = markAt(p)
    if (hit) setMarks((prev) => cycleSelection(prev, hit.id, frameAspect()))
  }

  function onPointerDown(e) {
    if (!enabled || liveRef.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const p = toFrame(e)
    // Ignore presses on the panel's padding, outside the photo.
    if (!p || p[0] < 0 || p[0] > 1000 || p[1] < 0 || p[1] > 1000) return
    if (tool === 'eraser') {
      eraseAt(p)
      return
    }
    if (tool === 'select') {
      selectAt(p)
      return
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    // The size token is on-screen mm; store the width in frame units (px on
    // a 1000px-wide frame) so the line keeps its weight on any screen, and
    // keep the chosen size (size_mm) so the AI can name it.
    const svgWidth = svgRef.current?.getBoundingClientRect().width || 1000
    const { mm, px } = sizeFromToken(size)
    const width = round1(px * (1000 / svgWidth))
    const mark = {
      id: `m${nextIdRef.current++}`,
      color: markToken('--mark-color', '#fde68a'),
      width,
      size_mm: mm,
      points: [p.map(round1)],
      started_ms: elapsed(),
    }
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
    const mark = { ...cur.mark, duration_ms: Math.max(0, elapsed() - cur.mark.started_ms) }
    setMarks((prev) => [...prev, mark])
    setHistory((h) => [...h, { type: 'draw', id: mark.id }])
  }

  // Undo the last draw (removes the stroke) or erase (brings it back).
  function undo() {
    const last = history[history.length - 1]
    if (!last) return
    setHistory((h) => h.slice(0, -1))
    if (last.type === 'draw') {
      setMarks((prev) => prev.filter((m) => m.id !== last.id))
    } else {
      setMarks((prev) => prev.map((m) => {
        if (m.id !== last.id) return m
        const { erased_ms, ...rest } = m // eslint-disable-line no-unused-vars
        return { ...rest, erased: false }
      }))
    }
  }

  // Start over: back to framing, or a retaken photo. Ids and times restart.
  function clear() {
    setMarksState([])
    setHistory([])
    nextIdRef.current = 1
    startRef.current = null
  }

  return {
    marks,
    live,
    setMarks,
    // Marks on screen (erased ones are kept in `marks` but not counted).
    count: marks.filter(isVisibleMark).length,
    canUndo: history.length > 0,
    undo,
    clear,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  }
}

/**
 * The Marks step controls: Pen, Select, Eraser, Undo on the first row;
 * line size and the B&W photo toggle on the second. Two rows so it fits
 * a phone. The step is optional; Skip lives in the footer.
 */
export default function MarkPanel({
  tool,
  onToolChange,
  size = DEFAULT_MARK_SIZE,
  onSizeChange,
  blackAndWhite = false,
  onBlackAndWhiteChange,
  count,
  canUndo,
  onUndo,
  disabled,
}) {
  const toolClass = (on) =>
    `flex h-11 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-base font-semibold ${
      on ? 'bg-sc-border text-white' : 'text-sc-text2 hover:text-white'
    }`
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" aria-pressed={tool === 'pen'} className={toolClass(tool === 'pen')} onClick={() => onToolChange('pen')}>
          <Icon name="pen" size={18} />Pen
        </button>
        <button type="button" aria-pressed={tool === 'select'} className={toolClass(tool === 'select')} onClick={() => onToolChange('select')} disabled={disabled || count === 0}>
          Select
        </button>
        <button type="button" aria-pressed={tool === 'eraser'} className={toolClass(tool === 'eraser')} onClick={() => onToolChange('eraser')} disabled={disabled || count === 0}>
          Eraser
        </button>
        <button type="button" className={toolClass(false)} onClick={onUndo} disabled={disabled || !(canUndo ?? count > 0)}>
          Undo
        </button>
        <span className="ml-auto whitespace-nowrap text-sm font-semibold text-sc-text3">Optional</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="pr-1 text-sm font-semibold text-sc-text3" id="mark-size-label">Line</span>
        <div role="group" aria-labelledby="mark-size-label" className="flex items-center gap-1">
          {MARK_SIZES.map((s) => {
            const label = markToken(s.token, s.fallback).replace(/mm$/, '')
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={size === s.key}
                aria-label={`${label} mm line`}
                className={toolClass(size === s.key)}
                onClick={() => { onSizeChange?.(s.key); onToolChange('pen') }}
                disabled={disabled}
              >
                {label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          aria-pressed={blackAndWhite}
          className={`ml-auto ${toolClass(blackAndWhite)}`}
          onClick={() => onBlackAndWhiteChange?.(!blackAndWhite)}
        >
          B&amp;W
        </button>
      </div>
    </div>
  )
}
