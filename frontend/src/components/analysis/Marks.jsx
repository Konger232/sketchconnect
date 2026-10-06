import { useEffect, useRef, useState } from 'react'
import Icon from '../common/Icon'
import { squareScale } from '../../lib/markGeometry'

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
 *   - selected: the sketcher's focus. With the Pen, a tap on a line already
 *     drawn selects it, and a second tap unselects it (no Select tool since
 *     October 6, 2026). Marks analysis asks about selected marks first.
 *
 * Four pieces:
 *   - useMarkDrawing: pointer handling + the marks list (CreateSketch).
 *     Tool 'pen' draws (a tap on a drawn line selects or unselects it),
 *     'eraser' erases the mark under the tap.
 *   - MarksLayer: an SVG <g> that renders visible marks inside any 0-1000
 *     viewBox overlay (CreateSketch, GuideStage), with a halo under
 *     highlighted marks
 *   - MarkPanel (default): the Marks step tools in the right panel, on
 *     tablet and desktop: Pen, Eraser, Undo, Color, Line
 *   - MarkRail: the same tools as a floating rail on the photo, on a phone
 */

// Every mark uses one of the --mark-color-* tokens and one of the
// --mark-size-* tokens (index.css). The colour is stored as a hex value
// with the mark (composite.py draws it). All marks share one colour:
// picking another redraws every mark (design doc, item 21). The size is
// stored as size_mm, and the width is converted to frame units when the
// stroke starts.
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

// The line colours in the Marks tools, in order.
export const MARK_COLORS = [
  { key: 'red', label: 'Red', token: '--mark-color-red', fallback: '#f87171' },
  { key: 'yellow', label: 'Yellow', token: '--mark-color-yellow', fallback: '#fde68a' },
  { key: 'green', label: 'Green', token: '--mark-color-green', fallback: '#86efac' },
]
export const DEFAULT_MARK_COLOR = 'yellow'

// A Pen stroke that stays within this many frame units of where it started
// is a tap. A tap on a drawn line selects or unselects it; a tap anywhere
// else leaves a dot.
const TAP_REACH = 6

// A colour key as the hex value stored with a mark.
export function markColor(key) {
  const c = MARK_COLORS.find((m) => m.key === key) || MARK_COLORS[1]
  return markToken(c.token, c.fallback)
}

// How to select a mark: shown under the tools (MarkPanel) and, on a phone,
// in the panel below the photo (CreateSketch).
export const SELECT_HINT = 'Tap a line you drew to select it. Tap it again to unselect. Selected lines are asked about first.'

// The label for a size button: the token's number, so "0.5mm" shows "0.5".
const sizeLabel = (s) => markToken(s.token, s.fallback).replace(/mm$/, '')

// A size token in mm (or px), as { mm, px }. CSS has 96 px per inch.
function sizeFromToken(key) {
  const size = MARK_SIZES.find((s) => s.key === key) || MARK_SIZES[1]
  const raw = markToken(size.token, size.fallback)
  const n = parseFloat(raw)
  const px = raw.endsWith('px') ? n : (n * 96) / 25.4
  const mm = raw.endsWith('px') ? (n * 25.4) / 96 : n
  return { mm: Math.round(mm * 100) / 100, px }
}

// How close (frame units) a tap has to be to a mark for the Eraser and for
// answering a guided question by tapping a line.
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
// the Eraser here and by EditSketch.
export function markAtPoint(marks, p, aspect = 1) {
  const [sx, sy] = squareScale(aspect)
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]
    if (isVisibleMark(m) && m.points.some((q) => Math.hypot((q[0] - p[0]) * sx, (q[1] - p[1]) * sy) <= HIT_REACH)) return m
  }
  return null
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
  // While a guided question points at marks (highlight), those marks get
  // the selection halo and every other mark fades. Otherwise, while any
  // mark is selected, the others fade (--mark-dim-opacity).
  const anySelected = visible.some((m) => m.selected)
  const lit = new Set(highlight)
  const dimmed = (m) => (lit.size ? !lit.has(m.id) : anySelected && !m.selected)
  const haloed = (m) => (lit.size ? lit.has(m.id) : m.selected)

  return (
    <g ref={gRef} className="pointer-events-none">
      {/* Halos first, so every mark draws on top of every halo. Colour,
          width and opacity come from the --mark-select-* tokens, and the
          fade of unselected marks from --mark-dim-opacity. */}
      {visible.filter(haloed).map((m, i) => (
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
export function useMarkDrawing(svgRef, { enabled, tool = 'pen', size = DEFAULT_MARK_SIZE, color = DEFAULT_MARK_COLOR }) {
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

  // One colour for every mark: picking a colour redraws them all.
  function recolor(key) {
    const hex = markColor(key)
    setMarks((prev) => prev.map((m) => (m.color === hex ? m : { ...m, color: hex })))
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
    e.currentTarget.setPointerCapture?.(e.pointerId)
    // The size token is on-screen mm; store the width in frame units (px on
    // a 1000px-wide frame) so the line keeps its weight on any screen, and
    // keep the chosen size (size_mm) so the AI can name it.
    const svgWidth = svgRef.current?.getBoundingClientRect().width || 1000
    const { mm, px } = sizeFromToken(size)
    const width = round1(px * (1000 / svgWidth))
    const mark = {
      id: `m${nextIdRef.current++}`,
      color: markColor(color),
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
    // A tap on a line already drawn: select it, or unselect it. No new mark.
    const [x0, y0] = cur.mark.points[0]
    const isTap = cur.mark.points.every(([x, y]) => Math.hypot(x - x0, y - y0) <= TAP_REACH)
    const hit = isTap ? markAt([x0, y0]) : null
    if (hit) {
      setMarks((prev) => prev.map((m) => (m.id === hit.id ? { ...m, selected: !m.selected } : m)))
      return
    }
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
    recolor,
    clear,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  }
}

// The tools' shared props: tool, onToolChange, size, onSizeChange, color,
// onColorChange, count, canUndo, onUndo, disabled. Picking a size or a
// colour also picks the Pen.

/**
 * The Marks step tools in the right panel (tablet and desktop, where
 * there is room): how to select a mark first, then one tool per row: Pen,
 * Eraser, Undo, Color and Line. The step is optional; Skip lives in the
 * footer.
 */
export default function MarkPanel({
  tool,
  onToolChange,
  size = DEFAULT_MARK_SIZE,
  onSizeChange,
  color = DEFAULT_MARK_COLOR,
  onColorChange,
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
      <p className="pb-2 text-sm text-sc-text3">{SELECT_HINT}</p>
      <button type="button" aria-pressed={tool === 'pen'} className={`self-start ${toolClass(tool === 'pen')}`} onClick={() => onToolChange('pen')}>
        <Icon name="pen" size={18} />Pen
      </button>
      <button type="button" aria-pressed={tool === 'eraser'} className={`self-start ${toolClass(tool === 'eraser')}`} onClick={() => onToolChange('eraser')} disabled={disabled || count === 0}>
        <Icon name="eraser" size={18} />Eraser
      </button>
      <button type="button" className={`self-start ${toolClass(false)}`} onClick={onUndo} disabled={disabled || !(canUndo ?? count > 0)}>
        <Icon name="undo" size={18} />Undo
      </button>
      <div className="flex items-center gap-1">
        <span className="flex w-24 shrink-0 items-center gap-1.5 pl-3 text-base font-semibold text-sc-text2" id="mark-color-label">
          <Icon name="color" size={18} />Color
        </span>
        <div role="group" aria-labelledby="mark-color-label" className="flex items-center gap-1">
          {MARK_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={color === c.key}
              aria-label={`${c.label} lines`}
              className={toolClass(color === c.key)}
              onClick={() => { onColorChange?.(c.key); onToolChange('pen') }}
              disabled={disabled}
            >
              <span className="h-4 w-4 rounded-full" style={{ background: markColor(c.key) }} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="flex w-24 shrink-0 items-center gap-1.5 pl-3 text-base font-semibold text-sc-text2" id="mark-size-label">
          <Icon name="thickness" size={18} />Line
        </span>
        <div role="group" aria-labelledby="mark-size-label" className="flex items-center gap-1">
          {MARK_SIZES.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={size === s.key}
              aria-label={`${sizeLabel(s)} mm line`}
              className={toolClass(size === s.key)}
              onClick={() => { onSizeChange?.(s.key); onToolChange('pen') }}
              disabled={disabled}
            >
              {sizeLabel(s)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The Marks step tools as a floating rail on the photo, for a phone, where
 * the right panel sits below the photo. Same look as the old Guides rail
 * (the .rail classes in index.css).
 *
 *   collapsed   one "Marks" button, bottom right
 *   open        Pen, Color, Eraser, Line, Undo, and a close button. Color
 *               and Line slide their choices out to the left, level with
 *               the button: red, yellow, green; 0.5, 1, 2.
 */
export function MarkRail({
  tool,
  onToolChange,
  size = DEFAULT_MARK_SIZE,
  onSizeChange,
  color = DEFAULT_MARK_COLOR,
  onColorChange,
  count,
  canUndo,
  onUndo,
  disabled,
}) {
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState(null) // 'color' | 'line' | null

  if (!open) {
    return (
      <button type="button" className="rail-toggle" aria-expanded="false" onClick={() => setOpen(true)}>
        <Icon name="pen" size={22} />
        Marks
      </button>
    )
  }

  const pick = (t) => { setSub(null); onToolChange(t) }
  const button = (key, label, icon, props) => (
    <button key={key} type="button" className="rail-group" disabled={disabled} {...props}>
      <Icon name={icon} size={18} />
      {label}
    </button>
  )
  const subRail = (label, items) => (
    <div className="rail absolute right-full top-1/2 mr-3.5 -translate-y-1/2 flex-col animate-fade-in-scale" role="group" aria-label={label}>
      {items}
    </div>
  )

  return (
    <div className="rail flex-col" role="toolbar" aria-label="Marks" aria-orientation="vertical">
      {button('pen', 'Pen', 'pen', { 'aria-pressed': tool === 'pen' && !sub, onClick: () => pick('pen') })}
      <div className="relative">
        {button('color', 'Color', 'color', {
          'aria-pressed': sub === 'color',
          'aria-expanded': sub === 'color',
          style: { color: sub === 'color' ? undefined : markColor(color) },
          onClick: () => setSub((cur) => (cur === 'color' ? null : 'color')),
        })}
        {sub === 'color' && subRail('Color', MARK_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            className="rail-tool flex items-center gap-2"
            aria-pressed={color === c.key}
            onClick={() => { onColorChange?.(c.key); pick('pen') }}
          >
            <span className="h-3.5 w-3.5 rounded-full" style={{ background: markColor(c.key) }} />
            {c.label}
          </button>
        )))}
      </div>
      {button('eraser', 'Eraser', 'eraser', {
        'aria-pressed': tool === 'eraser' && !sub,
        disabled: disabled || count === 0,
        onClick: () => pick('eraser'),
      })}
      <div className="relative">
        {button('line', 'Line', 'thickness', {
          'aria-pressed': sub === 'line',
          'aria-expanded': sub === 'line',
          onClick: () => setSub((cur) => (cur === 'line' ? null : 'line')),
        })}
        {sub === 'line' && subRail('Line thickness', MARK_SIZES.map((s) => (
          <button
            key={s.key}
            type="button"
            className="rail-tool"
            aria-pressed={size === s.key}
            aria-label={`${sizeLabel(s)} mm line`}
            onClick={() => { onSizeChange?.(s.key); pick('pen') }}
          >
            {sizeLabel(s)}
          </button>
        )))}
      </div>
      {button('undo', 'Undo', 'undo', {
        disabled: disabled || !(canUndo ?? count > 0),
        onClick: () => { setSub(null); onUndo() },
      })}
      <button
        type="button"
        aria-label="Close marks tools"
        className="flex h-11 w-[var(--rail-button)] items-center justify-center rounded-xl text-sc-muted hover:text-white"
        onClick={() => { setSub(null); setOpen(false) }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
