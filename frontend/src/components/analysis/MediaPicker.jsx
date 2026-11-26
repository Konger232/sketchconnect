import { MEDIA } from '../../data/media'

/**
 * "What you draw with" (design doc, item 25): the media picks, any number.
 * The tips may name only these. Shared by New Sketch and Capture's
 * Details (item 57).
 */
export default function MediaPicker({ picks, onToggle }) {
  return (
    <div className="flex flex-col gap-4">
      {MEDIA.map(({ group, items }) => (
        <div key={group} className="flex flex-col gap-2" role="group" aria-label={group}>
          <p className="text-base font-semibold text-sc-text3">{group}</p>
          <div className="flex flex-wrap gap-2">
            {items.map(([key, name]) => (
              <button
                key={key}
                type="button"
                aria-pressed={picks.includes(key)}
                onClick={() => onToggle(key)}
                className={`rounded-full border-[1.5px] px-3.5 py-2 text-md font-semibold transition-colors ${
                  picks.includes(key)
                    ? 'border-sc-guide bg-sc-guide text-sc-guide-ink'
                    : 'border-sc-divider text-white hover:border-white/60'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
