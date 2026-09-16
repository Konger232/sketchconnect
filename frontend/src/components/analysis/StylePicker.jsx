import Button from '../common/Button'
import { STYLES } from '../../data/styles'

export default function StylePicker({ style, analyzing, error, onSelectStyle }) {
  return (
    <div className="flex flex-col justify-center gap-4 bg-white p-5 text-ink md:p-6">
      <div>
        <h1 className="text-base font-bold tracking-tight">Pick a style</h1>
        <p className="mt-1 text-xs text-ink/60">This shapes how the AI looks at your scene.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STYLES.map((s) => (
          <button
            key={s.value}
            type="button"
            disabled={analyzing}
            onClick={() => onSelectStyle(s.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50 ${
              style === s.value ? 'bg-ink text-white' : 'bg-ink/10 text-ink/80 hover:bg-ink/20'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {analyzing && <p className="animate-fade-in-up text-sm text-ink/60">Looking at your scene…</p>}
      {error && <p className="text-sm text-accent">{error}</p>}
    </div>
  )
}