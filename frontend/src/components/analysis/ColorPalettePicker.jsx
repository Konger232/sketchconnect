import MascotIcon from '../common/MascotIcon'
import { AI_PROMPT_SIZES as S } from '../../lib/aiPromptSizing'

// "Do you want to pick a color palette?" — three preset wheels. Real
// swatch values are a design pass away from the Figma file; these are
// stand-ins with the same three-way warm/neutral/cool split shown there.
const PALETTES = [
  { id: 'warm', label: 'Warm Colors', swatches: ['#c9622a', '#e0a63a', '#8a5a2f', '#d9c9a3'] },
  { id: 'neutral', label: 'Neutral Colors', swatches: ['#6b7a63', '#a9a48f', '#4d4d47', '#cfcabd'] },
  { id: 'cool', label: 'Cool Colors', swatches: ['#2f3f6b', '#5b7fa6', '#0f1d3d', '#bcd2e8'] },
]

// Renders as plain content inside GuidedPromptFlow.jsx's white controls
// panel now, not a fixed bottom sheet of its own -- see AIPromptModal.jsx
// for the same change and why. Sizing comes from lib/aiPromptSizing.js.
export default function ColorPalettePicker({ onSelect, onSkip }) {
  return (
    <div className="animate-fade-in-up">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MascotIcon className={`${S.mascotIcon} ${S.mascotIconMd}`} />
          <p className={`${S.paletteHeadingText} ${S.paletteHeadingTextMd}`}>Do you want to pick a color palette?</p>
        </div>
        {onSkip && (
          <button onClick={onSkip} aria-label="Close" className={`${S.closeIcon} ${S.closeIconMd} text-ink/50 transition-colors hover:text-ink`}>×</button>
        )}
      </div>
      <div className={`grid grid-cols-3 ${S.paletteGrid} ${S.paletteGridMd}`}>
        {PALETTES.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className="flex flex-col items-center gap-2 rounded-xl border border-black/15 p-3 transition-all duration-150 hover:bg-black/5 active:scale-[0.97]"
          >
            <div className={`grid grid-cols-2 grid-rows-2 overflow-hidden rounded-full ring-1 ring-black/10 ${S.paletteSwatchSize} ${S.paletteSwatchSizeMd}`}>
              {p.swatches.map((c) => (
                <div key={c} style={{ backgroundColor: c }} />
              ))}
            </div>
            <span className={`font-medium ${S.paletteLabelText} ${S.paletteLabelTextMd}`}>{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
