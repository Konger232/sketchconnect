/**
 * Draws Gemini-traced perspective/vanishing lines over the reference
 * photo, on demand -- only rendered while the sketcher has actually
 * asked to see them (SketchFlowPage tracks that from their answer to
 * the "perspective_lines" prepared prompt; see rules.py's seed options
 * for that key: index 0 = show all lines, index 1 = show just the
 * strongest one, index 2 = skip).
 *
 * `lines` is the flat [x1, y1, x2, y2, ...] list from the scene analysis
 * response (SceneAnalysisResponse.perspective_lines, 0-1000 scale,
 * grouped in fours) -- same normalized-coordinate convention as
 * ShapeOutlineOverlay's contour_points, so it uses the same
 * viewBox="0 0 1000 1000" / preserveAspectRatio="none" SVG setup. Kept
 * as its own component rather than folded into ShapeOutlineOverlay
 * because these are construction/guide lines, not object silhouettes --
 * different visual language (dashed, cooler color) makes that distinct
 * at a glance.
 */
export default function PerspectiveLinesOverlay({ lines = [] }) {
  const segments = []
  for (let i = 0; i + 3 < lines.length; i += 4) {
    segments.push([lines[i], lines[i + 1], lines[i + 2], lines[i + 3]])
  }
  if (segments.length === 0) return null

  return (
    <svg
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {segments.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#42f5e9"
          strokeWidth={1.5}
          opacity=".8"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}
