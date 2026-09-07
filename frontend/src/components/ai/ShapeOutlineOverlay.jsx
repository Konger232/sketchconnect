/**
 * Draws focal_regions as thin traced-outline polygons over the reference
 * photo, matching the shape-outline look from the Figma prototype.
 * contour_points is a flat [x1, y1, x2, y2, ...] list on a 0-1000 scale
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
export default function ShapeOutlineOverlay({ focalRegions = [] }) {
  return (
    <svg
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {focalRegions.map((region, i) => {
        const pts = region.contour_points || []
        const points = []
        for (let j = 0; j + 1 < pts.length; j += 2) {
          points.push(`${pts[j]},${pts[j + 1]}`)
        }
        if (points.length < 3) return null
        return (
          <polygon
            key={i}
            points={points.join(' ')}
            fill="none"
            stroke="#e81e1e"
            strokeWidth={1.5}
            strokeDasharray="6 5"
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}
