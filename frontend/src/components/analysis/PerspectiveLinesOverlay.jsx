/**
 * Draws the scene's perspective over the reference photo, on demand (the
 * "Perspective lines" toggle):
 *   - eye level: one dashed horizontal line, when it falls inside the frame
 *   - each real edge Gemini traced, extended on to its vanishing point, so
 *     the sketcher sees the edges meet
 *   - each vanishing point that falls inside the frame, as a small ring
 *
 * `perspective` is SceneAnalysisResponse.perspective (backend
 * features/scene_analysis/schemas.py): { eye_level_y, kind,
 * vanishing_points: [{ x, y, edges: [x1, y1, x2, y2, ...] }] }, 0-1000
 * scale. Eye level and vanishing points may sit outside 0-1000. The SVG
 * doesn't clip (overflow visible), so eye level runs across the whole
 * stage and the edges run on toward vanishing points off the photo. The
 * stage around the photo clips them. Same viewBox="0 0 1000 1000" /
 * preserveAspectRatio="none" setup as ShapeOutlineOverlay.
 */
// Colours, widths, dashes and the ring size are tokens in index.css
// (--perspective-*).
const EYE_STYLE = {
  stroke: 'var(--perspective-eye-color)',
  strokeWidth: 'var(--perspective-eye-width)',
  strokeDasharray: 'var(--perspective-eye-dash)',
  opacity: 'var(--perspective-eye-opacity)',
}
const EDGE_STYLE = {
  stroke: 'var(--perspective-edge-color)',
  strokeWidth: 'var(--perspective-edge-width)',
  opacity: 'var(--perspective-edge-opacity)',
}
const VP_STYLE = {
  stroke: 'var(--perspective-edge-color)',
  strokeWidth: 'var(--perspective-vp-width)',
  r: 'var(--perspective-vp-radius)',
}

export function hasPerspective(perspective) {
  if (!perspective) return false
  const eye = perspective.eye_level_y
  const eyeInFrame = eye != null && eye >= 0 && eye <= 1000
  return eyeInFrame || (perspective.vanishing_points || []).length > 0
}

// The edge's end farther from the vanishing point, so the drawn line runs
// the full visible edge and on to the point.
function farEnd([x1, y1, x2, y2], vp) {
  const d1 = (x1 - vp.x) ** 2 + (y1 - vp.y) ** 2
  const d2 = (x2 - vp.x) ** 2 + (y2 - vp.y) ** 2
  return d1 >= d2 ? [x1, y1] : [x2, y2]
}

export default function PerspectiveLinesOverlay({ perspective }) {
  if (!hasPerspective(perspective)) return null
  const eye = perspective.eye_level_y
  const vps = perspective.vanishing_points || []

  return (
    <svg
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      overflow="visible"
    >
      {eye != null && eye >= 0 && eye <= 1000 && (
        <line
          x1={-2000}
          y1={eye}
          x2={3000}
          y2={eye}
          style={EYE_STYLE}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {vps.map((vp, v) => {
        const segments = []
        for (let i = 0; i + 3 < vp.edges.length; i += 4) {
          segments.push(vp.edges.slice(i, i + 4))
        }
        const inFrame = vp.x >= 0 && vp.x <= 1000 && vp.y >= 0 && vp.y <= 1000
        return (
          <g key={v}>
            {segments.map((seg, i) => {
              const [sx, sy] = farEnd(seg, vp)
              return (
                <line
                  key={i}
                  x1={sx}
                  y1={sy}
                  x2={vp.x}
                  y2={vp.y}
                  style={EDGE_STYLE}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
            {inFrame && (
              <circle
                cx={vp.x}
                cy={vp.y}
                r={8} /* fallback where CSS r isn't supported */
                fill="none"
                style={VP_STYLE}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}
