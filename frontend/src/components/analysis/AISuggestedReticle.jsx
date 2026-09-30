import { useEffect, useState } from 'react'
import { Reticle } from './Reticle'

/**
 * The AI's suggested focal point, shown while AIGuidance asks "The AI also
 * noticed ... Add it as a focal point?" (design doc, Section 11, item 13).
 *
 * `suggestion` is SceneAnalysisResponse.focal_suggestions[i] ({ region_ref,
 * label, x, y }) or null. A new suggestion fades in; when it changes or
 * goes back to null, the current one fades out first. Timing, glow and
 * colour are CSS tokens in index.css (--focal-accent-ai, --focal-ai-*).
 *
 * Renders an SVG <g>, so place it inside a viewBox="0 0 1000 1000" SVG.
 */
export default function AISuggestedReticle({ suggestion }) {
  const [shown, setShown] = useState(suggestion)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!shown) {
      setShown(suggestion)
      setLeaving(false)
    } else if (suggestion?.region_ref === shown.region_ref) {
      setLeaving(false)
    } else {
      setLeaving(true) // swap in `suggestion` once the fade-out ends
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion])

  function handleAnimationEnd(e) {
    if (e.animationName !== 'focal-ai-fade-out' || !leaving) return
    setShown(suggestion)
    setLeaving(false)
  }

  if (!shown) return null
  return (
    <g
      key={shown.region_ref}
      className={`focal-ai ${leaving ? 'focal-ai--out' : 'focal-ai--in'}`}
      onAnimationEnd={handleAnimationEnd}
    >
      <Reticle x={shown.x} y={shown.y} variant="ai" />
    </g>
  )
}
