/**
 * Draws focal_regions as thin traced-outline polygons over the reference
 * photo, matching the shape-outline look from the Figma prototype.
 * Each region's outline is `points`, [[x, y], ...] in 0-1000 frame units,
 * the same shape as a mark (design doc, item 17). Results cached before
 * that change only have contour_points, a flat [x1, y1, x2, y2, ...] list
 * on the same scale
 * (design doc, Section 3) -- this scales it to the rendered image's actual
 * pixel box via a plain percentage-based SVG overlay, so no image-load
 * timing math is needed.
 *
 * Design doc, Section 7 flagged real per-shape silhouette tracing as an
 * unconfirmed Gemini capability, with a coarser bounding-box fallback if
 * precision didn't hold up. A real test (see parking-lot.md) showed Gemini
 * tracing a recognizable silhouette -- tapered jar shape, canopy spread,
 * cluster boundary -- rather than just a box, so this renders the actual
 * traced polygon instead of the rectangle this used to draw.
 */
// variant "focal": the AI's focal areas (--focal-shape-* tokens).
// variant "answer": parts of the scene picked by a tap while answering a
// guide question (--answer-outline-* tokens). Both in index.css.
const STYLES = {
  focal: {
    fill: 'var(--focal-shape-fill)',
    fillOpacity: 'var(--focal-shape-fill-opacity)',
    stroke: 'var(--focal-shape-color)',
    strokeWidth: 'var(--focal-shape-stroke-width)',
    strokeDasharray: 'var(--focal-shape-dash)',
    opacity: 'var(--focal-shape-opacity)',
  },
  answer: {
    fill: 'var(--answer-outline-fill)',
    fillOpacity: 'var(--answer-outline-fill-opacity)',
    stroke: 'var(--answer-outline-color)',
    strokeWidth: 'var(--answer-outline-width)',
    strokeDasharray: 'var(--answer-outline-dash)',
    opacity: 'var(--answer-outline-opacity)',
  },
}

export default function ShapeOutlineOverlay({ focalRegions = [], variant = 'focal' }) {
  return (
    <svg
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {focalRegions.map((region, i) => {
        const points = []
        if (region.points?.length) {
          for (const [x, y] of region.points) points.push(`${x},${y}`)
        } else {
          const pts = region.contour_points || []
          for (let j = 0; j + 1 < pts.length; j += 2) points.push(`${pts[j]},${pts[j + 1]}`)
        }
        if (points.length < 3) return null
        return (
          <polygon
            key={region.id || i}
            points={points.join(' ')}
            style={STYLES[variant] || STYLES.focal}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}
