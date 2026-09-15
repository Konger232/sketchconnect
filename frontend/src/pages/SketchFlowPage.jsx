import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import GuidedPromptFlow from '../components/analysis/GuidedPromptFlow'
import { api } from '../lib/api'

/**
 * Thin RESUME wrapper around GuidedPromptFlow.jsx. Photo capture, crop,
 * focal-point marking, style selection, the scene-analysis call, and the
 * guided-prompt flow itself all now happen inside the capture wizard
 * (CreateSketch.jsx's Step 3 mounts GuidedPromptFlow directly, the
 * moment scene analysis returns) -- a fresh capture never lands here.
 *
 * This route exists only for a sketch that already has a style set but
 * hasn't finished the guided questions yet -- reached via "Resume the
 * AI-guided questions" in the AI Critique section of
 * EditSketch.jsx. There's nowhere
 * server-side that a scene-analysis result is cached to read back
 * (only style/scene_type persist on the Sketch row), so resuming means
 * re-running scene analysis once, then handing off to the same
 * GuidedPromptFlow the wizard uses.
 */
export default function SketchFlowPage() {
  const { sketchId } = useParams()
  const navigate = useNavigate()
  const routerLocation = useLocation()

  const [sketch, setSketch] = useState(null)
  const [step, setStep] = useState('loading') // 'loading' | 'analyzing' | 'ready' | 'no-style' | 'analysis-failed'
  const [analysis, setAnalysis] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get(`/api/sketches/${sketchId}`).then(({ data }) => {
      setSketch(data)
      if (!data.style) {
        // Only reachable for a sketch created before the capture wizard
        // set style at Step 2 -- there's no style-picker here anymore.
        setError('This sketch has no style set yet. Set one from Edit, then come back.')
        setStep('no-style')
        return
      }
      const handoff = routerLocation.state
      if (handoff?.analysis) {
        // Rare: a direct navigate with state already carrying an
        // analysis (kept for forward-compatibility with anything that
        // still hands off this way). Skips a second Gemini call.
        setAnalysis(handoff.analysis)
        setStep('ready')
      } else {
        runSceneAnalysis(data.style, data)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }).catch(() => setError('Could not load this sketch.'))
  }, [sketchId])

  async function runSceneAnalysis(value, sketchData = sketch) {
    setStep('analyzing')
    setError(null)
    try {
      const url = sketchData.reference_image_url.startsWith('http')
        ? sketchData.reference_image_url
        : `${api.defaults.baseURL}${sketchData.reference_image_url}`
      const res = await fetch(url)
      const blob = await res.blob()
      const form = new FormData()
      form.append('sketch_id', sketchData.id)
      form.append('style', value)
      form.append('image', blob, 'reference.jpg')
      const { data } = await api.post('/api/scene-analysis', form)
      setAnalysis(data)
      setStep('ready')
    } catch (err) {
      setError(err.response?.data?.detail || 'Scene analysis failed.')
      // No style-picker to fall back to anymore -- just sit here with
      // the error shown.
      setStep('analysis-failed')
    }
  }

  function resolveUrl(url) {
    return url.startsWith('http') ? url : `${api.defaults.baseURL}${url}`
  }

  if (step === 'loading' || !sketch) {
    return <div className="flex min-h-screen items-center justify-center bg-black p-8 text-center text-white/50">Loading…</div>
  }

  if (step === 'analyzing') {
    return <div className="flex min-h-screen items-center justify-center bg-black p-8 text-center text-white/60">Looking at your scene…</div>
  }

  if (step === 'no-style' || step === 'analysis-failed') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black p-8 text-center text-white">
        <p className="text-sm text-white/70">{error}</p>
        <button
          onClick={() => navigate(`/sketches/${sketchId}`)}
          className="text-sm font-medium text-white/50 underline transition-colors hover:text-white"
        >
          Back to sketch
        </button>
      </div>
    )
  }

  return (
    <GuidedPromptFlow
      sketchId={sketchId}
      referenceImageUrl={resolveUrl(sketch.reference_image_url)}
      title={sketch.title}
      style={sketch.style}
      analysis={analysis}
      fullPage
      onCancel={() => navigate(`/sketches/${sketchId}`)}
      // Same "finished guiding, back to your sketches" destination as
      // CreateSketch's own handleFinishWizard -- resuming from
      // here vs. finishing inline during capture shouldn't land the
      // sketcher anywhere different.
      onFinished={() => navigate('/profile')}
    />
  )
}
