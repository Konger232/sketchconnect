/**
 * The Value tab's right panel (design doc, item 37): how many values to
 * see (3, 5, 7 or 9), and the value distribution, as a value scale from
 * light to dark (1 is the lightest): how much of the photo falls in each value.
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
          // One row per value, lightest first (1 is the lightest, as on a
          // drawing value scale): its number, its grey, and a bar as long as
          // its share of the photo. The study comes darkest first.
          <div className="flex flex-col gap-1" aria-label="How much of the photo is in each value, lightest first">
            {[...study.distribution].reverse().map((pct, i) => {
              const tone = [...study.toneValues].reverse()[i]
              const grey = `rgb(${tone},${tone},${tone})`
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-right text-xs text-sc-text3">{i + 1}</span>
                  <span className="h-6 w-6 shrink-0 border border-[#cccccc]/60" style={{ background: grey }} />
                  <span className="flex h-6 min-w-0 flex-1 items-center">
                    <span className="block h-4 border border-white/15" style={{ width: `${Math.max(1, (pct / max) * 100)}%`, background: grey }} />
                  </span>
                  <span className="w-10 shrink-0 text-right text-xs font-semibold text-sc-text2">{pct.toFixed(pct < 10 ? 1 : 0)}%</span>
                </div>
              )
            })}
          </div>
        )}
        <p className="text-sm text-sc-text3">1 is the lightest, the white of the paper. A good sketch usually has one value that clearly leads.</p>
      </div>
    </div>
  )
}
