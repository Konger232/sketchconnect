import { useEffect, useState } from 'react'
import MascotIcon from '../common/MascotIcon'
import Button from '../common/Button'
import { api } from '../../lib/api'
import { AI_PROMPT_SIZES as S } from '../../lib/aiPromptSizing'

const OPTION_CLASS = `rounded-xl border border-black/15 text-left transition-all duration-150 hover:bg-black/5 active:scale-[0.98] ${S.optionPadding} ${S.optionPaddingMd} ${S.optionText} ${S.optionTextMd}`

/**
 * AI Prompts and Help Quest. For the right panel in CreateSketch.jsx and EditSketch.jsx only.
 */
export default function AIGuidance({ sketchId, referenceImageUrl, style, analysis, onFinished }) {

  const [promptIndex, setPromptIndex] = useState(0)

  // Help Quest ("Ask me"). Each answer is also saved server-side by
  // /api/help-quest, so the critique call can read it later.
  const [helpQuestOpen, setHelpQuestOpen] = useState(false)
  const [helpQuestQuestion, setHelpQuestQuestion] = useState('')
  const [helpQuestAnswer, setHelpQuestAnswer] = useState(null)

  // A fresh analysis (first-ever run, or a resume-flow re-run) always
  // starts this flow from a clean slate.
  useEffect(() => {
    setPromptIndex(0)
    setHelpQuestOpen(false)
    setHelpQuestAnswer(null)
  }, [analysis])

  function currentPrompt() {
    return analysis?.prepared_prompts?.[promptIndex] || null
  }

  function advancePrompt() {
    const next = promptIndex + 1
    if (analysis && next < analysis.prepared_prompts.length) {
      setPromptIndex(next)
    } else {
      onFinished?.()
    }
  }

  // Saved server-side so the critique call can read it later.
  // Not awaited: a failed save never blocks the sketcher.
  function handlePromptSelect(option) {
    api.post(`/api/sketches/${sketchId}/session-choices`, {
      prompt: currentPrompt().question,
      response: option,
    }).catch((err) => console.warn('Could not save session choice', err))
    advancePrompt()
  }

  function handleFinishNow() {
    onFinished?.()
  }

  async function fetchReferenceImageBlob() {
    const res = await fetch(referenceImageUrl)
    return res.blob()
  }

  async function handleHelpQuestSend() {
    if (!helpQuestQuestion.trim()) return
    try {
      const blob = await fetchReferenceImageBlob()
      const form = new FormData()
      form.append('sketch_id', sketchId)
      form.append('question', helpQuestQuestion)
      form.append('style', style)
      form.append('scene_type', analysis.scene_type)
      form.append('step_id', `prompt-${promptIndex}`)
      form.append('image', blob, 'reference.jpg')
      const { data } = await api.post('/api/help-quest', form)
      setHelpQuestAnswer(data.answer)
    } catch {
      setHelpQuestAnswer('Could not reach Help Quest right now.')
    }
  }

  return (
      <div className="flex flex-col justify-center gap-4 overflow-y-auto bg-paper p-5 text-ink md:p-6">
        {!analysis ? (
          <p className="text-sm text-ink/60">Preparing your questions…</p>
        ) : (
          <>
            {currentPrompt() && !helpQuestOpen && (
              
              <div className="animate-fade-in-up">
                <div className="mb-3 flex items-start gap-2">
                  <MascotIcon className={`mt-0.5 shrink-0 ${S.mascotIcon} ${S.mascotIconMd}`} />
                  <p className={`leading-snug ${S.questionText} ${S.questionTextMd}`}>{currentPrompt().question}</p>
                </div>
                <div className={`flex flex-col ${S.optionGap} ${S.optionGapMd}`}>
                  {(currentPrompt().options || []).map((opt) => (
                    <button key={opt} onClick={() => handlePromptSelect(opt)} className={OPTION_CLASS}>
                      {opt}
                    </button>
                  ))}
                  <button onClick={() => setHelpQuestOpen(true)} className={`flex items-center justify-between ${OPTION_CLASS}`}>
                    Ask me
                    <MascotIcon className={`${S.mascotIcon} ${S.mascotIconMd}`} />
                  </button>
                </div>
              </div>

            )}

            {/* Disabled before advisor meeting -- color-swatch step.
                ColorPalettePicker.jsx stays unused until true photo-derived
                palette extraction is built (see parking-lot.md). */}

            {!helpQuestOpen && currentPrompt() && (
              <Button variant="outline" size="sm" className="w-full" onClick={handleFinishNow}>
                Start Sketching Now
              </Button>
            )}

            {helpQuestOpen && (
              <div className="animate-fade-in-up">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className={`font-semibold ${S.helpHeadingText} ${S.helpHeadingTextMd}`}>Ask me anything about this scene</p>
                  <button
                    onClick={() => { setHelpQuestOpen(false); setHelpQuestAnswer(null) }}
                    className={`${S.closeIcon} ${S.closeIconMd} text-ink/50 transition-colors hover:text-ink`}
                  >
                    ×
                  </button>
                </div>
                {helpQuestAnswer ? (
                  <>
                    <p className={`animate-fade-in-up rounded-lg bg-black/5 p-3 ${S.helpInputText} ${S.helpInputTextMd}`}>{helpQuestAnswer}</p>
                    <Button
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() => { setHelpQuestOpen(false); setHelpQuestAnswer(null); setHelpQuestQuestion('') }}
                    >
                      Back to prompts
                    </Button>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={helpQuestQuestion}
                      onChange={(e) => setHelpQuestQuestion(e.target.value)}
                      placeholder="e.g. Should I start with the wine bottles?"
                      className={`flex-1 rounded-lg border border-black/15 text-ink transition-colors focus:border-ink/40 ${S.helpInputPadding} ${S.helpInputPaddingMd} ${S.helpInputText} ${S.helpInputTextMd}`}
                    />
                    <Button size="sm" onClick={handleHelpQuestSend}>Send</Button>
                  </div>
                )}
              </div>
            )}

            {analysis?.debug_raw_gemini_response && (
              <details className="rounded-lg border border-black/10 bg-black/5 p-3 text-xs">
                <summary className="cursor-pointer font-medium text-ink/60">Debug: raw Gemini response</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-ink/70">
                  {analysis.debug_raw_gemini_response}
                </pre>
              </details>
            )}
          </>
        )}
      </div>
    
    )
  }
  

