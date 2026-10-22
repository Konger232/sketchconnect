import { useState } from 'react'
import Button from './Button'
import { STYLES } from '../../data/styles'
import { api } from '../../lib/api'

/**
 * The coach names the style it sees in the final sketch; the sketcher says
 * whether they agree, or picks another (design doc, item 39). Owner only,
 * under the feedback on the SketchDetail page.
 *
 *   sketch     { id, style, style_detected, style_confirmed }
 *   onChange(patch)  the new style fields
 */
export default function StyleCheck({ sketch, onChange }) {
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const label = (v) => STYLES.find((x) => x.value === v)?.label || v

  async function save(body) {
    setBusy(true)
    try {
      await api.put(`/api/sketches/${sketch.id}`, body)
      onChange({
        style: body.style || sketch.style_detected,
        style_confirmed: body.style_confirmed,
      })
      setPicking(false)
    } finally {
      setBusy(false)
    }
  }

  if (!sketch.style_detected) return null
  const answered = sketch.style_confirmed !== null && sketch.style_confirmed !== undefined

  return (
    <div className="flex flex-col gap-2 border-t border-ink/10 pt-3">
      {!answered && !picking && (
        <>
          <p className="m-0 text-sm text-ink/80">The coach sees this sketch as <b>{label(sketch.style_detected)}</b>. Do you agree?</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="editorialSolid" size="sm" disabled={busy} onClick={() => save({ style_confirmed: true })}>Yes</Button>
            <Button variant="editorial" size="sm" disabled={busy} onClick={() => setPicking(true)}>No, it's another style</Button>
          </div>
        </>
      )}
      {answered && !picking && (
        <p className="m-0 text-sm text-ink/70">
          Style: <b>{label(sketch.style)}</b>
          {sketch.style_confirmed ? ' · you agreed with the coach' : ` · your pick (the coach saw ${label(sketch.style_detected)})`}
          {' · '}<button type="button" className="underline" onClick={() => setPicking(true)}>Change</button>
        </p>
      )}
      {picking && (
        <>
          <p className="m-0 text-sm text-ink/80">Which style is it?</p>
          <div className="flex flex-wrap gap-2">
            {STYLES.map((st) => (
              <Button key={st.value} variant={sketch.style === st.value ? 'editorialSolid' : 'editorial'} size="sm" disabled={busy}
                onClick={() => save(st.value === sketch.style_detected
                  ? { style_confirmed: true }
                  : { style: st.value, style_confirmed: false })}>
                {st.label}
              </Button>
            ))}
            <button type="button" className="text-sm underline" onClick={() => setPicking(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}
