/**
 * The Value tab's right panel (design doc, item 37): how many values to
 * see (3, 5, 7 or 9), and the value distribution, as a value scale from
 * black to white: how much of the photo falls in each value.
 *
 *   levels, onLevels(n)
 *   study   { toneValues, distribution } | null
 */
export const VALUE_LEVELS = [3, 5, 7, 9]

export default function ValuePanel({ levels, onLevels, study, loading, error }) {
  const max = Math.max(1, ...(study?.distribution || [1]))
  return (
    <div className="flex flex-col gap-5">
      <p className="text-md text-sc-text2">
        Squint at the scene. How many values do you want to see? Fewer values make the big shapes clear.
      </p>
      <div className="flex gap-2" role="radiogroup" aria-label="Number of values">
        {VALUE_LEVELS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={levels === n} onClick={() => onLevels(n)}
            className={`h-11 min-w-[56px] flex-1 rounded-full border-[1.5px] text-md font-bold transition-colors ${
              levels === n ? 'border-sc-guide bg-sc-guide text-white' : 'border-sc-border bg-sc-raised text-white hover:border-sc-strong'
            }`}>
            {n}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <span className="sc-field-label">Value distribution, %</span>
        {error && <p className="text-base text-accent">{error}</p>}
        {!study && !error && <p className="text-sm text-sc-text3">{loading ? 'Reading the values…' : ''}</p>}
        {study && (
          <div className="flex items-end gap-1.5" aria-label="How much of the photo is in each value, darkest first">
            {study.distribution.map((pct, i) => {
              const tone = study.toneValues[i]
              return (
                <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-semibold text-sc-text2">{pct.toFixed(pct < 10 ? 1 : 0)}</span>
                  <span className="flex h-16 w-full items-end">
                    <span className="block w-full rounded-sm border border-white/15" style={{ height: `${Math.max(2, (pct / max) * 64)}px`, background: `rgb(${tone},${tone},${tone})` }} />
                  </span>
                  <span className="h-6 w-full rounded-sm border border-white/15" style={{ background: `rgb(${tone},${tone},${tone})` }} />
                  <span className="text-xs text-sc-text3">{i + 1}</span>
                </div>
              )
            })}
          </div>
        )}
        <p className="text-sm text-sc-text3">1 is the darkest. A good sketch usually has one value that clearly leads.</p>
      </div>
    </div>
  )
}
