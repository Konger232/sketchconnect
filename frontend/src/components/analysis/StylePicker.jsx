import Icon from '../common/Icon'
import { STYLES } from '../../data/styles'

/**
 * The Style step (New Sketch, step 5): four cards in a 2 x 2 grid. The
 * selected card has a guide-blue border and a check badge. Picking a card
 * only selects it; the footer's "Analyze scene" runs the scene analysis.
 */
export default function StylePicker({ style, disabled, onSelectStyle }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {STYLES.map((s) => {
        const selected = style === s.value
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onSelectStyle(s.value)}
            className={`relative flex flex-col gap-1 rounded-[14px] border-2 bg-sc-raised px-3 pb-3 pt-2.5 text-left text-white transition-colors ${
              selected ? 'border-sc-guide' : 'border-sc-border hover:border-sc-strong'
            }`}
          >
            <span className="pr-7 text-md font-bold">{s.label}</span>
            <span className="text-sm leading-snug text-sc-text3">{s.desc}</span>
            {selected && (
              <span className="absolute right-2 top-2 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-sc-guide text-sc-guide-ink">
                <Icon name="check" size={16} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
