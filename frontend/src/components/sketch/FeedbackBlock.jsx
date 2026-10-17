import Icon from '../common/Icon'

const EVIDENCE = { plan: 'From your plan', intended: 'From your plan', prompted: 'From a guide question', instinct: 'By instinct', stages: 'Across stages' }
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

/**
 * The owner's feedback on the sketch page, light version of JourneyTrace
 * (Edit Sketch). Labelled "Only you". The critique text, then Habits and
 * Opportunities, each with its principle. Neutral icons, no checks or
 * warnings (design doc, item 15).
 */
export default function FeedbackBlock({ critique }) {
  if (!critique) return null
  const trace = critique.decision_trace || {}
  const rows = [
    ...(trace.habits || []).map((r) => ({ ...r, icon: 'habit', kind: 'Keep doing' })),
    ...(trace.opportunities || []).map((r) => ({ ...r, icon: 'opportunity', kind: 'Try next' })),
  ]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="m-0 font-sans text-lg font-normal">Feedback</h3>
        <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/70">
          <Icon name="lock" size={13} /> Only you
        </span>
      </div>
      {critique.critique && <p className="m-0 whitespace-pre-line text-base">{critique.critique}</p>}
      {rows.length > 0 && (
        <ul className="flex flex-col">
          {rows.map((r, i) => (
            <li key={i} className="flex gap-3 border-b border-[var(--ed-row-rule)] py-3">
              <Icon name={r.icon} size={20} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="text-base font-semibold">{cap(r.principle)} <span className="ed-caption ml-1">{r.kind}</span></span>
                <span className="text-base text-ink/80">{r.observation}</span>
                {EVIDENCE[r.evidence] && <span className="text-xs text-ink/50">{EVIDENCE[r.evidence]}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
