import MascotIcon from '../common/MascotIcon'

const PALETTES = [
  { id: 'warm', label: 'Warm Colors', swatches: ['#c9622a', '#e0a63a', '#8a5a2f', '#d9c9a3'] },
  { id: 'neutral', label: 'Neutral Colors', swatches: ['#6b7a63', '#a9a48f', '#4d4d47', '#cfcabd'] },
  { id: 'cool', label: 'Cool Colors', swatches: ['#2f3f6b', '#5b7fa6', '#0f1d3d', '#bcd2e8'] },
]

export default function ColorPalettePicker({ onSelect, onSkip }) {
  return (
    <div className="animate-fade-in-up">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MascotIcon className="ai_mascot" />
          <p className="palette-heading">Do you want to pick a color palette?</p>
        </div>
        {onSkip && (
          <button onClick={onSkip} aria-label="Close" className="ai-close text-ink/50 transition-colors hover:text-ink">×</button>
        )}
      </div>
      <div className="grid grid-cols-3 palette-grid">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className="flex flex-col items-center gap-2 rounded-xl border border-black/15 p-3 transition-all duration-150 hover:bg-black/5 active:scale-[0.97]"
          >
            <div className="palette-grid">
              {p.swatches.map((c) => (
                <div key={c} style={{ backgroundColor: c }} />
              ))}
            </div>
            <span className="palette-label">{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
