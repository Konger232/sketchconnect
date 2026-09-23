import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ImagePanel from './ImagePanel'
import ShapeOutlineOverlay from './ShapeOutlineOverlay'
import PerspectiveLinesOverlay from './PerspectiveLinesOverlay'
import AIPromptModal from './AIPromptModal'
import Button from '../common/Button'
import { api } from '../../lib/api'
import { WIZARD_PANEL_HEIGHT_CLASS } from '../../lib/wizardLayout'
import { computeImageBox, resolveAspectRatio } from '../../lib/cropMath'
import { useOverlayToggle } from '../../lib/useOverlayToggle'
import { AI_PROMPT_SIZES as S } from '../../lib/aiPromptSizing'

/**
 * The guided AI-prompts/Help Quest flow, a shared component
 * for CreateSketch.jsx and EditSketch.jsx
 */
export default function GuidedPromptFlow({
  sketchId,
  referenceImageUrl,
  title,
  style,
  analysis,
  fullPage = true,
  onFinished,
  onCancel,
}) {
  const containerRef = useRef(null)
  const [naturalSize, setNaturalSize] = useState(null)
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 })

  const perspectiveLines = useOverlayToggle(analysis)
  const focalAreas = useOverlayToggle(analysis)

  const [promptIndex, setPromptIndex] = useState(0)
  const [sessionChoices, setSessionChoices] = useState([])
  const [helpQuestLog, setHelpQuestLog] = useState([])
  const [helpQuestOpen, setHelpQuestOpen] = useState(false)
  const [helpQuestQuestion, setHelpQuestQuestion] = useState('')
  const [helpQuestAnswer, setHelpQuestAnswer] = useState(null)
  const [showPalette, setShowPalette] = useState(false)

  // A fresh analysis (first-ever run, or a resume-flow re-run) always
  // starts this flow from a clean slate.
  useEffect(() => {
    setPromptIndex(0)
    setSessionChoices([])
    setShowPalette(false)
    setHelpQuestOpen(false)
    setHelpQuestAnswer(null)
  }, [analysis])

  const ratio = resolveAspectRatio('original', naturalSize)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    function recompute() {
      const availableWidth = container.clientWidth
      const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768
      //const availableHeight = isDesktop && WIZARD_PANEL_HEIGHT_PX ? WIZARD_PANEL_HEIGHT_PX : window.innerHeight * 0.55
      const availableHeight = isDesktop ? container.clientHeight : window.innerHeight * 0.55
      if (!availableWidth || !availableHeight) return
      const heightAtFullWidth = availableWidth / ratio
      if (heightAtFullWidth <= availableHeight) {
        setBoxSize({ width: availableWidth, height: heightAtFullWidth })
      } else {
        setBoxSize({ width: availableHeight * ratio, height: availableHeight })
      }
    }
    recompute()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recompute) : null
    ro?.observe(container)
    window.addEventListener('resize', recompute)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', recompute)
    }
  }, [ratio])

  function handleImageLoad(e) {
    setNaturalSize({ width: e.target.naturalWidth, height: e.target.naturalHeight })
  }

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

  function handlePromptSelect(option) {
    const prompt = currentPrompt()
    setSessionChoices((prev) => [...prev, { prompt: prompt.question, response: option }])
    advancePrompt()
  }

  function handleFinishNow() {
    setShowPalette(false)
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

  const box =
    naturalSize && boxSize.width && boxSize.height
      ? computeImageBox(boxSize.width, boxSize.height, naturalSize.width, naturalSize.height, 1, 0, 0)
      : null

  const content = (
    <div className="animate-fade-in-up md:grid md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
      <div className="flex flex-col gap-3">
        <ImagePanel
          containerRef={containerRef}
          boxSize={boxSize}
          imageUrl={referenceImageUrl}
          box={box}
          zoom={1}
          offset={{ x: 0, y: 0 }}
          heightClass={WIZARD_PANEL_HEIGHT_CLASS}
          onImageLoad={handleImageLoad}
        >
          <ShapeOutlineOverlay focalRegions={focalAreas.mode !== 'none' ? analysis?.focal_regions || [] : []} />
          <PerspectiveLinesOverlay lines={perspectiveLines.mode !== 'none' ? analysis?.perspective_lines || [] : []} />
        </ImagePanel>
        <div className="flex gap-2 px-3 md:px-4">
          <Button
            variant={perspectiveLines.mode !== 'none' ? 'primary' : 'outline'}
            size="sm"
            onClick={perspectiveLines.toggle}
            disabled={!analysis?.perspective_lines?.length}
          >
            Perspective lines
          </Button>
          <Button
            variant={focalAreas.mode !== 'none' ? 'primary' : 'outline'}
            size="sm"
            onClick={focalAreas.toggle}
            disabled={!analysis?.focal_regions?.length}
          >
            Focal shapes
          </Button>
        </div>
        {fullPage && title && <p className="px-3 text-sm text-white/70 md:px-4">{title}</p>}
      </div>

      <div className="flex flex-col justify-center gap-4 overflow-y-auto bg-paper p-5 text-ink md:p-6">
        {!analysis ? (
          <p className="text-sm text-ink/60">Preparing your questions…</p>
        ) : (
          <>
            {currentPrompt() && !helpQuestOpen && !showPalette && (
              <AIPromptModal
                question={currentPrompt().question}
                options={currentPrompt().options}
                onSelect={handlePromptSelect}
                onAskMe={() => setHelpQuestOpen(true)}
              />
            )}

            {/* Disabled before advisor meeting -- color-swatch step.
                ColorPalettePicker.jsx stays unused until true photo-derived
                palette extraction is built (see parking-lot.md). */}

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
                <summary className="cursor-pointer font-medium text-ink/60">Debug: raw Gemini response</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-ink/70">
                  {analysis.debug_raw_gemini_response}
                </pre>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  )

  if (!fullPage) return content

  return (
    <div className="min-h-screen bg-black text-white md:h-screen md:overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        {onCancel ? (
          <Button variant="linkOnDark" type="button" onClick={onCancel} className="font-medium">
            Cancel
          </Button>
        ) : (
          <span className="invisible text-sm font-medium" aria-hidden="true">Cancel</span>
        )}
        <span className="text-sm font-semibold">AI Guidance</span>
        <span className="invisible text-sm font-medium" aria-hidden="true">Cancel</span>
      </div>
      <div className="px-3 pb-8 pt-3 md:px-8">{content}</div>
    </div>
  )
}
