import { useState } from 'react'
import Button from './Button'
import { STYLES } from '../../data/styles'
import { api } from '../../lib/api'

/**
 * The sketch's style (design doc, item 39): the four styles, with the one
 * the coach saw in the final sketch selected. The sketcher taps another if
 * it's different. Owner only, under the feedback on the SketchDetail page.
 *
 *   sketch     { id, style, style_detected }
 *   onChange(patch)  the new style fields
 */
export default function StyleCheck({ sketch, onChange }) {
  const [busy, setBusy] = useState(false)
  if (!sketch.style_detected) return null
  const current = sketch.style || sketch.style_detected

  async function pick(value) {
    if (value === current) return
    // Picking the coach's style again counts as agreeing with it.
    const body = value === sketch.style_detected ? { style_confirmed: true } : { style: value, style_confirmed: false }
    setBusy(true)
    try {
      await api.put(`/api/sketches/${sketch.id}`, body)
      onChange({ style: value, style_confirmed: body.style_confirmed })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-ink/10 pt-3">
      <span className="ed-caption">Style</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="The sketch's style">
        {STYLES.map((st) => (
          <Button key={st.value} variant={current === st.value ? 'editorialSolid' : 'editorial'} size="sm" disabled={busy}
            role="radio" aria-checked={current === st.value} onClick={() => pick(st.value)}>
            {st.label}
          </Button>
        ))}
      </div>
      <p className="m-0 text-xs text-ink/60">The coach picked the style it sees. Tap another if yours is different.</p>
    </div>
  )
}
