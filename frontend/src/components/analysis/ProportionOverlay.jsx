import { useEffect, useRef, useState } from 'react'

/**
 * The "proportions" overlay (question bank action), drawn the way a
 * sketcher measures with a pencil at arm's length: one unit (the pencil,
 * e.g. a lantern's height), then the same unit stepped along each span to
 * see how many times it fits. All guides measure one direction, set by the
 * unit: heights (vertical) or widths (horizontal). The backend drops spans
 * in the other direction. Each span keeps its traced lean, running along
 * the middle of its object from top to bottom, as a sketcher would.
 *
 * Thin lines with round ends in --proportion-color, --proportion-stroke-width
 * (index.css). No text on the photo: labels and ratios stay in the data
 * (the critique and Help Quest read them). Every span, the unit included,
 * gets the same small cross tick at each end and at every unit length.
 *
 * `proportions` is SceneAnalysisResponse.proportions: { axis, unit,
 * comparisons }, each { label, line: [x1, y1, x2, y2] (0-1000), ratio }.
 * Renders an SVG <g>, so place it inside a viewBox="0 0 1000 1000"
 * preserveAspectRatio="none" SVG.
 */
const TICK_PX = 5        // half-length of every tick, in screen px
const MAX_STEPS = 20     // don't draw more ticks than this on one span

export default function ProportionOverlay({ proportions }) {
  // The SVG stretches 0-1000 to its pixel box independently in x and y.
  // Measure that box so steps, ticks and labels are true on screen.
  const gRef = useRef(null)
  const [size, setSize] = useState(null)

  useEffect(() => {
    const svg = gRef.current?.ownerSVGElement
    if (!svg) return
    const measure = () => {
      const r = svg.getBoundingClientRect()
      if (r.width && r.height) setSize({ w: r.width, h: r.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  if (!proportions?.unit || !size) return <g ref={gRef} />
  const sx = 1000 / size.w // frame units per screen pixel, x
  const sy = 1000 / size.h // and y

  // Work in screen pixels, then convert back to frame units to draw.
  const toPx = ([x1, y1, x2, y2]) => [x1 / sx, y1 / sy, x2 / sx, y2 / sy]
  const toUnits = (x, y) => [x * sx, y * sy]
  const unitPx = (() => {
    const [a, b, c, d] = toPx(proportions.unit.line)
    return Math.hypot(c - a, d - b)
  })()

  // Tick across a line at pixel point (px, py), direction (ux, uy).
  function tick(px, py, ux, uy, half, key, color) {
    const [x1, y1] = toUnits(px - uy * half, py + ux * half)
    const [x2, y2] = toUnits(px + uy * half, py - ux * half)
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color}
      strokeWidth="var(--proportion-stroke-width)" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
  }

  function drawSpan(span, kind, i) {
    const color = 'var(--proportion-color)'
    const [ax, ay, bx, by] = toPx(span.line)
    const len = Math.hypot(bx - ax, by - ay) || 1
    const ux = (bx - ax) / len
    const uy = (by - ay) / len
    const parts = [
      <line key="line" x1={span.line[0]} y1={span.line[1]} x2={span.line[2]} y2={span.line[3]} stroke={color}
        strokeWidth="var(--proportion-stroke-width)" strokeLinecap="round" vectorEffect="non-scaling-stroke" />,
      tick(ax, ay, ux, uy, TICK_PX, 'start', color),
      tick(bx, by, ux, uy, TICK_PX, 'end', color),
    ]
    if (kind === 'span' && unitPx > 0) {
      // Step the unit along the span: one tick per whole unit.
      const steps = Math.min(MAX_STEPS, Math.floor(len / unitPx + 0.01))
      for (let k = 1; k <= steps; k++) {
        const d = k * unitPx
        if (len - d < unitPx * 0.1) break // too close to the end tick
        parts.push(tick(ax + ux * d, ay + uy * d, ux, uy, TICK_PX, `s${k}`, color))
      }
    }
    return <g key={i}>{parts}</g>
  }

  return (
    <g ref={gRef} className="pointer-events-none">
      {drawSpan(proportions.unit, 'unit', 'unit')}
      {(proportions.comparisons || []).map((c, i) => drawSpan(c, 'span', i))}
    </g>
  )
}
