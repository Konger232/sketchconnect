import MascotIcon from '../common/MascotIcon'

/**
 * The recurring bottom-sheet pattern from the Figma prototype: mascot icon
 * + a short AI-voiced question, then a stack of full-width option buttons.
 * Every guided step in the sketch flow (scene analysis prompts, "What is
 * your style?", "Do you want to pick a color palette?") is this same shape
 * with different content — one component, not one screen per step.
 *
 * `onAskMe`, when passed, renders the trailing "Ask me" option that opens
 * Help Quest (design doc: Help Quest is reached from inside a prepared
 * prompt, not a separate nav item).
 */
export default function AIPromptModal({ question, options = [], onSelect, onAskMe, onClose }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl bg-paper p-5 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] text-ink">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <MascotIcon className="mt-1 h-5 w-5 shrink-0" />
          <p className="text-lg font-medium leading-snug">{question}</p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close" className="text-xl leading-none text-ink/50">
            ×
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onSelect?.(opt)}
            className="rounded-xl border border-black/15 px-4 py-3 text-left text-base hover:bg-black/5"
          >
            {opt}
          </button>
        ))}
        {onAskMe && (
          <button
            onClick={onAskMe}
            className="flex items-center justify-between rounded-xl border border-black/15 px-4 py-3 text-left text-base hover:bg-black/5"
          >
            Ask me
            <MascotIcon className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  )
}
