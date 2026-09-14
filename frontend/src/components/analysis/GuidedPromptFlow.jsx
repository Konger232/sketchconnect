import { useEffect, useState } from 'react'
import Button from '../common/Button'
import AIPromptModal from './AIPromptModal'
import ColorPalettePicker from './ColorPalettePicker'
import ShapeOutlineOverlay from './ShapeOutlineOverlay'
import PerspectiveLinesOverlay from './PerspectiveLinesOverlay'
import { api } from '../../lib/api'
import { AI_PROMPT_SIZES as S } from '../../lib/aiPromptSizing'
import { WIZARD_IMAGE_MAX_WIDTH_CLASS, WIZARD_PANEL_HEIGHT_CLASS } from '../../lib/wizardLayout'

/**
 * The guided, on-location AI-prompt flow: work through prepared prompts
 * at your own pace (design doc, Section 5), with "Ask me" dropping into
 * Help Quest at any point, ending in an optional color-palette pick.
 * Extracted so there's exactly one implementation shared by two call
 * sites:
 *
 *  - SceneAnalyzerWizard.jsx's Step 3, mounted the moment scene analysis
 *    returns -- rendered inline inside the wizard's fixed-size modal
 *    (`fullPage={false}`).
 *  - SketchFlowPage.jsx, a thin full-page wrapper used only to RESUME
 *    this flow later (the "Start/Resume AI guidance" button on
 *    SketchWorkspaceModal.jsx), for a sketch that already has a style set
 *    but hasn't finished the questions yet (`fullPage` defaults to true).
 *
 * `onFinished` fires once every prepared prompt (and the palette step)
 * has been answered -- what "done" means is entirely up to the caller
 * (the wizard closes and hands off to critique; the resume page
 * navigates the same way). This component has no "time to sketch" phase
 * of its own -- that hand-off is the caller's job.
 *
 * Sizing: the question/option/palette/help-quest text, padding, and icon
 * sizes all come from `lib/aiPromptSizing.js` -- edit that one file to
 * retune how big any of this reads, especially on desktop where the
 * two-panel layout gives it more room than it needs.
 */
export default function GuidedPromptFlow({
  sketchId,
  referenceImageUrl,
  title = null,
  style,
  analysis,
  fullPage = true,
  onFinished,
  onCancel,
}) {
  const [perspectiveLinesMode, setPerspectiveLinesMode] = useState('none')
  const [focalAreasMode, setFocalAreasMode] = useState('none')
  const [promptIndex, setPromptIndex] = useState(0)
  const [sessionChoices, setSessionChoices] = useState([])
  const [helpQuestLog, setHelpQuestLog] = useState([])
  const [helpQuestOpen, setHelpQuestOpen] = useState(false)
  const [helpQuestQuestion, setHelpQuestQuestion] = useState('')
  const [helpQuestAnswer, setHelpQuestAnswer] = useState(null)
  const [showPalette, setShowPalette] = useState(false)

  // Reset all of the above whenever a fresh analysis comes in -- covers
  // both the wizard's first-ever analysis and the resume page's re-run.
  useEffect(() => {
    setPerspectiveLinesMode('none')
    setFocalAreasMode('none')
    setPromptIndex(0)
    setSessionChoices([])
    setShowPalette(false)
    setHelpQuestOpen(false)
    setHelpQuestAnswer(null)
  }, [analysis])

  async function fetchImageBlob() {
    const res = await fetch(referenceImageUrl)
    return res.blob()
  }

  function currentPrompt() {
    return analysis?.prepared_prompts?.[promptIndex] || null
  }

  function handlePromptSelect(option) {
    const prompt = currentPrompt()
    if (prompt.key === 'perspective_lines') {
      const optionIndex = prompt.options.indexOf(option)
      setPerspectiveLinesMode(optionIndex === 0 ? 'all' : optionIndex === 1 ? 'strongest' : 'none')
    }
    if (prompt.key === 'show_focal_areas') {
      const optionIndex = prompt.options.indexOf(option)
      setFocalAreasMode(optionIndex === 0 ? 'all' : optionIndex === 1 ? 'strongest' : 'none')
    }
    setSessionChoices((prev) => [...prev, { prompt: prompt.question, response: option }])
    advancePrompt()
  }

  function advancePrompt() {
    const next = promptIndex + 1
    if (analysis && next < analysis.prepared_prompts.length) {
      setPromptIndex(next)
    } else if (!showPalette) {
      setShowPalette(true)
    } else {
      onFinished?.()
    }
  }

  function handlePaletteDone() {
    setShowPalette(false)
    onFinished?.()
  }

  // A sketcher who already knows what they want to draw shouldn't have
  // to click through every remaining prepared prompt (and the palette
  // step, which always came last) just to reach sketching -- this ends
  // the guided-question flow immediately, from wherever they currently
  // are in it.
  function handleFinishNow() {
    setShowPalette(false)
    onFinished?.()
  }

  async function handleHelpQuestSend() {
    if (!helpQuestQuestion.trim()) return
    try {
      const blob = await fetchImageBlob()
      const form = new FormData()
      form.append('sketch_id', sketchId)
      form.append('question', helpQuestQuestion)
      form.append('style', style)
      form.append('scene_type', analysis.scene_type)
      form.append('step_id', `prompt-${promptIndex}`)
      form.append('image', blob, 'reference.jpg')
      const { data } = await api.post('/api/help-quest', form)
      setHelpQuestAnswer(data.answer)
      setHelpQuestLog((prev) => [...prev, {
        step_id: `prompt-${promptIndex}`,
        question: helpQuestQuestion,
        answer: data.answer,
        principle_reference: data.principle_reference,
      }])
    } catch {
      setHelpQuestAnswer('Could not reach Help Quest right now.')
    }
  }

  const imageClassName = fullPage
    ? `w-full object-cover md:h-full md:w-auto md:max-w-full md:object-contain ${WIZARD_IMAGE_MAX_WIDTH_CLASS}`
    : `aspect-[4/3] w-full object-contain md:aspect-auto md:h-full md:w-auto md:max-w-full ${WIZARD_IMAGE_MAX_WIDTH_CLASS}`

  const panels = (
    <>
      <div className={`flex flex-col items-center justify-center gap-3 bg-black ${fullPage ? 'p-4 md:p-8' : `p-3 md:p-4 ${WIZARD_PANEL_HEIGHT_CLASS}`}`}>
        <div className={`relative w-full max-w-md overflow-hidden rounded-xl ${fullPage ? 'md:h-full md:w-auto md:max-w-none md:max-h-[80vh]' : 'md:h-full md:w-auto md:max-w-full'}`}>
          <img src={referenceImageUrl} alt="" className={imageClassName} />
          {focalAreasMode !== 'none' && analysis?.focal_regions?.length > 0 && (
            <ShapeOutlineOverlay
              focalRegions={focalAreasMode === 'strongest' ? analysis.focal_regions.slice(0, 1) : analysis.focal_regions}
            />
          )}
          {perspectiveLinesMode !== 'none' && analysis?.perspective_lines?.length > 0 && (
            <PerspectiveLinesOverlay
              lines={perspectiveLinesMode === 'strongest' ? analysis.perspective_lines.slice(0, 4) : analysis.perspective_lines}
            />
          )}
        </div>
        {fullPage && title && (
          <h1 className="text-center text-sm font-semibold tracking-tight text-white/80">{title}</h1>
        )}
      </div>

      <div className={`flex flex-col justify-center gap-4 overflow-y-auto bg-paper p-5 text-ink ${fullPage ? 'md:p-8' : 'md:p-6'}`}>
        {onCancel && (
          <div className="flex justify-end">
            <button onClick={onCancel} className="text-sm font-medium text-ink/50 hover:text-ink">
              Cancel
            </button>
          </div>
        )}

        {currentPrompt() && !helpQuestOpen && !showPalette && (
          <AIPromptModal
            question={currentPrompt().question}
            options={currentPrompt().options}
            onSelect={handlePromptSelect}
            onAskMe={() => setHelpQuestOpen(true)}
          />
        )}

        {showPalette && (
          <ColorPalettePicker onSelect={handlePaletteDone} onSkip={handlePaletteDone} />
        )}

        {!helpQuestOpen && (currentPrompt() || showPalette) && (
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
            <summary className="cursor-pointer font-medium text-ink/60">
              Debug: raw Gemini response
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-ink/70">
              {analysis.debug_raw_gemini_response}
            </pre>
          </details>
        )}
      </div>
    </>
  )

  if (!fullPage) {
    return <div className="md:grid md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">{panels}</div>
  }

  return (
    <div className="min-h-screen bg-black text-white md:grid md:h-screen md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] md:overflow-hidden">
      {panels}
    </div>
  )
}
