import MascotIcon from '../common/MascotIcon'
import { AI_PROMPT_SIZES as S } from '../../lib/aiPromptSizing'

/**
 * The recurring AI-question pattern from the Figma prototype: mascot icon
 * + a short AI-voiced question, then a stack of full-width option buttons.
 * Every guided step in the sketch flow (scene analysis prompts, "What is
 * your style?", "Do you want to pick a color palette?") is this same shape
 * with different content — one component, not one screen per step.
 *
 * Renders as plain content, not a positioned overlay of its own -- it's
 * embedded inline inside GuidedPromptFlow.jsx's white controls panel (the
 * bg-paper/text-ink surface it was styled for lives one level up now),
 * not floating as a fixed bottom sheet the way it used to.
 *
 * Sizing (text/padding/icon) comes from lib/aiPromptSizing.js so it can be
 * fine-tuned in one place, independent of the rest of the app's scale.
 *
 * `onAskMe`, when passed, renders the trailing "Ask me" option that opens
 * Help Quest (design doc: Help Quest is reached from inside a prepared
 * prompt, not a separate nav item).
 */
export default function AIPromptModal({ question, options = [], onSelect, onAskMe, onClose }) {
  return (
    <div className="animate-fade-in-up">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <MascotIcon className={`mt-0.5 shrink-0 ${S.mascotIcon} ${S.mascotIconMd}`} />
          <p className={`leading-snug ${S.questionText} ${S.questionTextMd}`}>{question}</p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close" className={`${S.closeIcon} ${S.closeIconMd} text-ink/50 transition-colors hover:text-ink`}>
            ×
          </button>
        )}
      </div>
      <div className={`flex flex-col ${S.optionGap} ${S.optionGapMd}`}>
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onSelect?.(opt)}
            className={`rounded-xl border border-black/15 text-left transition-all duration-150 hover:bg-black/5 active:scale-[0.98] ${S.optionPadding} ${S.optionPaddingMd} ${S.optionText} ${S.optionTextMd}`}
          >
            {opt}
          </button>
        ))}
        {onAskMe && (
          <button
            onClick={onAskMe}
            className={`flex items-center justify-between rounded-xl border border-black/15 text-left transition-all duration-150 hover:bg-black/5 active:scale-[0.98] ${S.optionPadding} ${S.optionPaddingMd} ${S.optionText} ${S.optionTextMd}`}
          >
            Ask me
            <MascotIcon className={`${S.mascotIcon} ${S.mascotIconMd}`} />
          </button>
        )}
      </div>
    </div>
  )
}
