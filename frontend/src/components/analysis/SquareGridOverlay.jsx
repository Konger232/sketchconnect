import { useEffect, useRef, useState } from 'react'

/**
 * The "grid" overlay: a square grid for the grid method (the sketcher draws
 * the same number of squares on paper and copies the photo square by
 * square). Cells are --grid-cell-mm millimetres on screen (index.css),
 * using the CSS millimetre (96 px per inch), and always square on screen
 * whatever the photo's shape. Starts at the top-left corner of the frame.
 * Used instead of the rule-of-thirds grid for the realistic style.
 *
 * Renders an SVG <g>, so place it inside a viewBox="0 0 1000 1000"
 * preserveAspectRatio="none" SVG. onCountChange({ cols, rows }) reports how
 * many squares fit, so the page can tell the sketcher what to draw.
 */
const PX_PER_MM = 96 / 25.4

function cellMm() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--grid-cell-mm')
  const mm = parseFloat(raw)
  return Number.isFinite(mm) && mm > 0 ? mm : 10
}

export default function SquareGridOverlay({ onCountChange }) {
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

  const cellPx = cellMm() * PX_PER_MM
  const cols = size ? Math.ceil(size.w / cellPx) : 0
  const rows = size ? Math.ceil(size.h / cellPx) : 0

  useEffect(() => {
    if (size) onCountChange?.({ cols, rows })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows])

  if (!size) return <g ref={gRef} />
  const ux = (cellPx * 1000) / size.w // one cell in frame units, x
  const uy = (cellPx * 1000) / size.h // and y
  const lines = []
  for (let c = 1; c < cols; c++) {
    lines.push(<line key={`c${c}`} x1={c * ux} y1={0} x2={c * ux} y2={1000} vectorEffect="non-scaling-stroke" />)
  }
  for (let r = 1; r < rows; r++) {
    lines.push(<line key={`r${r}`} x1={0} y1={r * uy} x2={1000} y2={r * uy} vectorEffect="non-scaling-stroke" />)
  }

  return (
    <g
      ref={gRef}
      className="pointer-events-none"
      stroke="var(--grid-line-color)"
      strokeWidth="var(--grid-line-width)"
    >
      {lines}
    </g>
  )
}
