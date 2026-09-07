import MascotIcon from '../common/MascotIcon'

// "Do you want to pick a color palette?" — three preset wheels. Real
// swatch values are a design pass away from the Figma file; these are
// stand-ins with the same three-way warm/neutral/cool split shown there.
const PALETTES = [
  { id: 'warm', label: 'Warm Colors', swatches: ['#c9622a', '#e0a63a', '#8a5a2f', '#d9c9a3'] },
  { id: 'neutral', label: 'Neutral Colors', swatches: ['#6b7a63', '#a9a48f', '#4d4d47', '#cfcabd'] },
  { id: 'cool', label: 'Cool Colors', swatches: ['#2f3f6b', '#5b7fa6', '#0f1d3d', '#bcd2e8'] },
]

export default function ColorPalettePicker({ onSelect, onSkip }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl bg-paper p-5 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] text-ink">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MascotIcon className="h-5 w-5" />
          <p className="text-lg font-medium">Do you want to pick a color palette?</p>
        </div>
        {onSkip && (
          <button onClick={onSkip} aria-label="Close" className="text-xl leading-none text-ink/50">×</button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className="flex flex-col items-center gap-2 rounded-xl border border-black/15 p-3 hover:bg-black/5"
          >
            <div className="grid h-16 w-16 grid-cols-2 grid-rows-2 overflow-hidden rounded-full">
              {p.swatches.map((c) => (
                <div key={c} style={{ backgroundColor: c }} />
              ))}
            </div>
            <span className="text-xs font-medium">{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
