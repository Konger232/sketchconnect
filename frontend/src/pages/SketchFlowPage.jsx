import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Button from '../components/common/Button'
import AIPromptModal from '../components/ai/AIPromptModal'
import ColorPalettePicker from '../components/ai/ColorPalettePicker'
import ShapeOutlineOverlay from '../components/ai/ShapeOutlineOverlay'
import PerspectiveLinesOverlay from '../components/ai/PerspectiveLinesOverlay'
import { api } from '../lib/api'

/**
 * The guided, on-location flow: get scene analysis for the style already
 * chosen back in the capture wizard's Step 2 (CapturePage.jsx), work
 * through prepared prompts at your own pace (design doc, Section 5), with
 * "Ask me" dropping into Help Quest at any point. Finishes by handing off
 * to the critique step once the sketcher has something to show.
 *
 * Renders full-viewport on a black background, no Header -- the whole
 * AI workflow (this page plus the capture wizard) is visually set apart
 * from the rest of the app that way.
 *
 * Steps: loading -> analyzing -> prompts -> help_quest (overlay) -> sketching -> critique
 */
export default function SketchFlowPage() {
  const { sketchId } = useParams()
  const navigate = useNavigate()

  const [sketch, setSketch] = useState(null)
  const [step, setStep] = useState('loading')
  const [style, setStyle] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  // How much of the Gemini-traced perspective_lines to show, driven by
  // which option the sketcher picked for the "perspective_lines"
  // prepared prompt (rules.py's seed options for that key: index 0 =
  // show all lines, index 1 = show just the strongest one, index 2 =
  // skip) -- nothing renders until they actually ask for it.
  const [perspectiveLinesMode, setPerspectiveLinesMode] = useState('none')
  // Same on-demand pattern for focal_regions, driven by the
  // "show_focal_areas" prepared prompt (index 0 = show all regions,
  // index 1 = show just the strongest/first one, index 2 = skip).
  // Gemini always computes focal_regions, but it's never auto-shown --
  // see parking-lot.md.
  const [focalAreasMode, setFocalAreasMode] = useState('none')
  const [promptIndex, setPromptIndex] = useState(0)
  const [sessionChoices, setSessionChoices] = useState([])
  const [helpQuestLog, setHelpQuestLog] = useState([])
  const [helpQuestOpen, setHelpQuestOpen] = useState(false)
  const [helpQuestQuestion, setHelpQuestQuestion] = useState('')
  const [helpQuestAnswer, setHelpQuestAnswer] = useState(null)
  const [showPalette, setShowPalette] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get(`/api/sketches/${sketchId}`).then(({ data }) => {
      setSketch(data)
      if (data.style) {
        // Resuming a flow that was left mid-way (e.g. via Cancel) --
        // style was already chosen and scene analysis already ran once
        // for this sketch, so skip straight back into it instead of
        // asking again. This still fires a fresh Gemini call:
        // prepared_prompts, focal_regions, and scene_summary are never
        // persisted (only style/scene_type survive on the Sketch row --
        // see sketches.py/_sketch_to_dict), so "resuming" means
        // re-analyzing, not replaying a cached result.
        setStyle(data.style)
        runSceneAnalysis(data.style, data)
      } else {
        // Only reachable for a sketch created before the capture wizard
        // set style at Step 2 -- there's no style-picker here anymore.
        setError('This sketch has no style set yet. Set one from Edit, then come back.')
        setStep('no-style')
      }
    }).catch(() => setError('Could not load this sketch.'))
  }, [sketchId])

  async function fetchImageBlob(sketchData = sketch) {
    const res = await fetch(sketchData.reference_image_url.startsWith('http')
      ? sketchData.reference_image_url
      : `${api.defaults.baseURL}${sketchData.reference_image_url}`)
    return res.blob()
  }

  async function runSceneAnalysis(value, sketchData = sketch) {
    setStep('analyzing')
    setError(null)
    try {
      const blob = await fetchImageBlob(sketchData)
      const form = new FormData()
      form.append('sketch_id', sketchData.id)
      form.append('style', value)
      form.append('image', blob, 'reference.jpg')
      const { data } = await api.post('/api/scene-analysis', form)
      setAnalysis(data)
      setPerspectiveLinesMode('none')
      setFocalAreasMode('none')
      setPromptIndex(0)
      setStep('prompts')
    } catch (err) {
      setError(err.response?.data?.detail || 'Scene analysis failed.')
      // No style-picker to fall back to anymore -- just sit here with
      // the error shown; nothing else renders for this step.
      setStep('analysis-failed')
    }
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
      setStep('sketching')
    }
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

  if (step === 'loading' || !sketch) {
    return <div className="flex min-h-screen items-center justify-center bg-black p-8 text-center text-white/50">Loading…</div>
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-2xl px-4 pb-40 pt-6">
        {step === 'prompts' && (
          <div className="pt-4 flex justify-end">
            <button
              onClick={() => navigate(`/sketches/${sketchId}`)}
              className="text-sm font-medium text-white/60 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}
        <div className={`relative overflow-hidden rounded-xl ${step === 'prompts' ? 'mt-2' : 'mt-4'}`}>
          <img src={
            sketch.reference_image_url.startsWith('http')
              ? sketch.reference_image_url
              : `${api.defaults.baseURL}${sketch.reference_image_url}`
          } alt="" className="w-full object-cover" />
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
        {sketch.title && <h1 className="mt-3 text-lg font-semibold">{sketch.title}</h1>}

        {error && <p className="mt-3 text-sm text-accent">{error}</p>}

        {step === 'analyzing' && (
          <p className="mt-6 text-center text-white/60">Looking at your scene…</p>
        )}

        {analysis?.debug_raw_gemini_response && (
          <details className="mt-4 rounded-lg border border-white/15 bg-white/5 p-3 text-xs">
            <summary className="cursor-pointer font-medium text-white/60">
              Debug: raw Gemini response
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-white/70">
              {analysis.debug_raw_gemini_response}
            </pre>
          </details>
        )}

        {step === 'sketching' && (
          <div className="mt-6 text-center">
            <p className="text-lg font-medium">Time to sketch!</p>
            <p className="mt-1 text-sm text-white/60">
              Work through it at your own pace. Come back and add your finished sketch
              whenever you're ready for feedback.
            </p>
            <Button className="mt-4" onClick={() => navigate(`/sketches/${sketchId}?critique=1`)}>
              I'm ready for feedback
            </Button>
          </div>
        )}
      </main>

      {step === 'prompts' && currentPrompt() && !helpQuestOpen && !showPalette && (
        <AIPromptModal
          question={currentPrompt().question}
          options={currentPrompt().options}
          onSelect={handlePromptSelect}
          onAskMe={() => setHelpQuestOpen(true)}
        />
      )}

      {step === 'prompts' && showPalette && (
        <ColorPalettePicker
          onSelect={() => { setShowPalette(false); setStep('sketching') }}
          onSkip={() => { setShowPalette(false); setStep('sketching') }}
        />
      )}

      {helpQuestOpen && (
        <div className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl bg-paper p-5 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] text-ink">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-lg font-medium">Ask me anything about this scene</p>
            <button onClick={() => { setHelpQuestOpen(false); setHelpQuestAnswer(null) }} className="text-xl text-ink/50">×</button>
          </div>
          {helpQuestAnswer ? (
            <>
              <p className="rounded-lg bg-black/5 p-3 text-sm">{helpQuestAnswer}</p>
              <Button className="mt-3 w-full" onClick={() => { setHelpQuestOpen(false); setHelpQuestAnswer(null); setHelpQuestQuestion('') }}>
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
                className="flex-1 rounded-lg border border-black/15 px-3 py-2 text-ink"
              />
              <Button onClick={handleHelpQuestSend}>Send</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
