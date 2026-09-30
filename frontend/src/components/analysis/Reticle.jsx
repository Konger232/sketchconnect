import { useEffect, useId, useRef, useState } from 'react'

// Sizes come from CSS tokens (index.css :root), read once per render as px.
function cssPx(name, fallback) {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  return Number.isFinite(v) ? v : fallback
}

const GLOW_RADIUS_PX = 46

/**
 * A reticle, drawn inside any viewBox="0 0 1000 1000"
 * preserveAspectRatio="none" SVG. The SVG stretches x and y separately, so
 * the marker measures the SVG and draws in screen pixels (a scale that
 * undoes the stretch): circles stay round and numbers aren't squashed.
 *
 *   no number     a blue ring over a white halo: a spot the sketcher
 *                 marked on their lines (design doc, item 17)
 *   variant 'ai'  a spot or focal area the AI points at: a ring in
 *                 --focal-accent-ai over a soft glow of the same colour
 *   number set    a numbered disc (the retired focal point step)
 *
 * Moved out of FocalSpotPicker.jsx when focal points became marks.
 *
 * Colours and sizes are the --focal-* tokens in index.css.
 */
export function Reticle({ x, y, variant = 'user', number }) {
  const gRef = useRef(null)
  const [scale, setScale] = useState(null)
  // useId can contain ':' or other characters that break url(#id).
  const glowId = `focal-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  useEffect(() => {
    const svg = gRef.current?.ownerSVGElement
    if (!svg) return
    const measure = () => {
      const rect = svg.getBoundingClientRect()
      if (rect.width && rect.height) setScale({ x: rect.width / 1000, y: rect.height / 1000 })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  if (!scale) return <g ref={gRef} />
  const transform = `translate(${x} ${y}) scale(${1 / scale.x} ${1 / scale.y})`

  if (variant === 'ai') {
    const r = cssPx('--focal-ring-radius', 15)
    return (
      <g ref={gRef} transform={transform}>
        <defs>
          <radialGradient id={glowId}>
            <stop offset="0%" style={{ stopColor: 'var(--focal-accent-ai)', stopOpacity: 'var(--focal-ai-glow-opacity)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--focal-accent-ai)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <circle className="focal-ai-glow" r={GLOW_RADIUS_PX} fill={`url(#${glowId})`} />
        <circle r={r} fill="none" stroke="var(--focal-point-ring)" strokeWidth={cssPx('--focal-ring-halo', 5)} />
        <circle r={r} fill="none" stroke="var(--focal-accent-ai)" strokeWidth={cssPx('--focal-ring-width', 3)} />
      </g>
    )
  }

  if (number != null) {
    const ring = cssPx('--focal-point-ring-width', 3)
    const r = cssPx('--focal-point-size', 36) / 2 - ring / 2
    return (
      <g ref={gRef} transform={transform}>
        <circle r={r} fill="var(--focal-accent-user)" stroke="var(--focal-point-ring)" strokeWidth={ring} />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--focal-point-number)"
          fontSize={15}
          fontWeight={800}
          fontFamily="Inter, sans-serif"
        >
          {number}
        </text>
      </g>
    )
  }

  const r = cssPx('--focal-ring-radius', 15)
  return (
    <g ref={gRef} transform={transform}>
      <circle r={r} fill="none" stroke="var(--focal-point-ring)" strokeWidth={cssPx('--focal-ring-halo', 5)} />
      <circle r={r} fill="none" stroke="var(--focal-accent-user)" strokeWidth={cssPx('--focal-ring-width', 3)} />
    </g>
  )
}
