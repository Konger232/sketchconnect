import Icon from '../common/Icon'

/**
 * The critique's process record under the feedback text (design doc,
 * Section 11, item 15): Habits (keep doing) and Opportunities (try next
 * time). Each row names one Berkeley element or principle and where the
 * evidence came from. Neutral on purpose: no checks, no warnings.
 *
 *   trace: critique.decision_trace
 *     new:  { habits: [{ observation, principle, evidence }], opportunities: [...] }
 *     old:  { carried_through: [text], shifted: [text], instinct_only: [text] }
 *
 * Rows stored before item 15 have the old shape and show as a plain list.
 * Colours: --trace-* tokens in index.css.
 */
const EVIDENCE_LABELS = {
  plan: 'From your plan',
  prompted: 'From a guide question',
  instinct: 'By instinct',
  stages: 'Across stages',
}

const SECTIONS = [
  { key: 'habits', title: 'Habits', hint: 'Keep doing', icon: 'habit', accent: 'var(--trace-habit-accent)' },
  { key: 'opportunities', title: 'Opportunities', hint: 'Try next time', icon: 'opportunity', accent: 'var(--trace-opportunity-accent)' },
]

// Before item 15.
const LEGACY_ROWS = [
  { key: 'carried_through', name: 'Kept from your plan' },
  { key: 'shifted', name: 'Changed from your plan' },
  { key: 'instinct_only', name: 'Drawn by instinct' },
]

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export default function JourneyTrace({ trace }) {
  if (!trace) return null

  if (Array.isArray(trace.habits) || Array.isArray(trace.opportunities)) {
    const sections = SECTIONS.filter((s) => (trace[s.key] || []).length > 0)
    if (sections.length === 0) return null
    return (
      <div className="flex flex-col gap-5">
        {sections.map((s) => (
          <section key={s.key} className="flex flex-col gap-2.5" style={{ '--trace-accent': s.accent }}>
            <h3 className="flex items-center gap-2">
              <span className="trace-icon"><Icon name={s.icon} size={16} /></span>
              {/* <span className="text-md font-bold text-white">{s.title}</span> */}
              <span className="text-md font-bold text-white">{s.hint}</span>
            </h3>
            <ul className="flex flex-col gap-2">
              {trace[s.key].map((item, i) => (
                <li key={i} className="trace-row">
                  <p className="text-base leading-snug text-sc-text">{item.observation}</p>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="trace-tag">{capitalize(item.principle)}</span>
                    {EVIDENCE_LABELS[item.evidence] && (
                      <span className="text-sm text-sc-text3">{EVIDENCE_LABELS[item.evidence]}</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    )
  }

  const rows = LEGACY_ROWS.flatMap((row) => (trace[row.key] || []).map((text) => ({ ...row, text })))
  if (rows.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <li key={i} className="trace-row">
          <span className="text-md font-bold text-white">{row.name}</span>
          <span className="text-base text-sc-text3">{row.text}</span>
        </li>
      ))}
    </ul>
  )
}
