import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import FocalFrameEditor from '../components/analysis/FocalFrameEditor'
import GuidedPromptFlow from '../components/analysis/GuidedPromptFlow'
import { STYLES } from '../data/styles'
import { api } from '../lib/api'
import { WIZARD_IMAGE_MAX_WIDTH_CLASS, WIZARD_PANEL_HEIGHT_CLASS, WIZARD_PANEL_HEIGHT_PX } from '../lib/wizardLayout'

const STEPS = ['capture', 'style', 'summary']
const STEP_LABELS = { capture: 'Capture', style: 'Style', summary: 'Guidance' }

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${api.defaults.baseURL}${url}`
}

// The scene-analyzer wizard (SceneAnalyzerWizard): reached only via the
// camera icon (Header.jsx /
// NavDrawer.jsx), which passes the sketcher's current page as
// `backgroundLocation` in router state. App.jsx's Router() uses that to
// render this as an overlay -- a centered card with a dimmed backdrop on
// desktop/tablet (the IG "Edit info" pattern -- Cancel / step indicator
// top bar, image-forward layout), or a fullscreen black takeover on
// mobile (same markup either way; only Tailwind's `md:` breakpoint
// differs). A direct/refreshed visit has no backgroundLocation to render
// underneath, so it falls back to rendering as a normal full page via the
// same main <Routes> block -- this component doesn't need to know the
// difference.
//
// Three steps, all deferred-metadata (design consolidation, 2026-09):
//
//   1. 'capture' -- photo + focal-point marking + crop/pan/zoom, ALL ONE
//      SCREEN, in that order: mark first ("what caught your eye"), THEN
//      refine the frame -- fewer clicks, and marking on the raw photo
//      before any cropping means nothing the sketcher points at can
//      already be cropped away. Internally this has two phases sketchers
//      never see labeled separately: phase A is just "pick a photo" --
//      no crop UI, and no separate "Continue" tap either. Picking a file
//      immediately POSTs /api/sketches (the plain original photo,
//      uncropped) in the background (a small "Uploading..." overlay on
//      the preview is the only sign of it). Once the sketchId comes back,
//      phase B mounts FocalFrameEditor.jsx (already a combined
//      mark-then-frame-refine component) on that same visible photo --
//      no screen swap, no "step 1 of 2" counter, just markers becoming
//      placeable on the photo the sketcher already has in front of them.
//      FocalFrameEditor's own save/skip affordance is what advances to
//      step 2.
//   2. 'style' -- single-tap style pills. Picking one PUTs the style
//      onto the sketch and immediately fires the scene-analysis Gemini
//      call (POST /api/scene-analysis) inline on the same screen, no
//      separate "Continue" button.
//   3. 'summary' -- despite the internal step name (kept for STEPS/
//      STEP_LABELS continuity), this is no longer a static recap: it
//      mounts GuidedPromptFlow.jsx (shared with SketchFlowPage.jsx's
//      resume path) directly, so the AI's guided questions start right
//      here as soon as scene analysis returns -- no more handing off to
//      a separate route mid-flow. Finishing every prompt (and the
//      palette step) closes the wizard and lands on the sketch detail
//      page with ?critique=1, the same hand-off SketchFlowPage used to
//      make.
//
// Title / field notes / location / date are NOT part of this wizard --
// deferred entirely to SketchWorkspaceModal.jsx, opened once sketching/critique
// is done (see SketchWorkspaceModal.jsx).
export default function SceneAnalyzerWizard() {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const backgroundLocation = routerLocation.state?.backgroundLocation

  function closeWizard() {
    navigate(backgroundLocation || '/profile')
  }

  const [step, setStep] = useState('capture') // 'capture' | 'style' | 'summary'

  // -- Step 1, phase A: just "pick a photo" -- no crop UI, no Continue
  // button. Cropping/panning/zooming happens once, in FocalFrameEditor's
  // own frame-adjusting phase (phase B, below) -- AFTER marking, per the
  // sketcher-marks-first ordering. See parking-lot.md for why this
  // isn't a pre-upload crop step (it used to be, briefly).
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  // -- Step 1, phase B: filled in once phase A's POST returns --
  const [sketchId, setSketchId] = useState(null)
  const [originalImageUrl, setOriginalImageUrl] = useState(null)
  // The reference (post-crop) photo -- what scene analysis actually sees
  // and what GuidedPromptFlow displays next, as distinct from
  // originalImageUrl (the untouched upload FocalFrameEditor re-crops
  // from). Starts out equal to originalImageUrl when nothing's cropped,
  // and gets updated to whatever FocalFrameEditor just re-baked once the
  // sketcher adjusts the frame.
  const [referenceImageUrl, setReferenceImageUrl] = useState(null)
  const [cropTransform, setCropTransform] = useState(null)

  // -- Step 2: style, and the analysis it triggers --
  const [style, setStyle] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState(null)

  const [error, setError] = useState(null)

  function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setPreview(URL.createObjectURL(f))
    // Uploads immediately -- no Continue tap in between. `f` is passed
    // straight through rather than round-tripped via state, since there's
    // no other reason to hold onto the raw File object here.
    uploadPhoto(f)
  }

  async function uploadPhoto(f) {
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      // The plain, untouched original -- the backend reads its GPS/
      // timestamp EXIF from these bytes (a re-baked canvas export strips
      // EXIF entirely). No framed_image/crop_transform here: cropping now
      // happens once, after marking, in FocalFrameEditor's frame-adjusting
      // phase (phase B below) -- not duplicated here first.
      form.append('image', f)
      const { data } = await api.post('/api/sketches', form)
      setSketchId(data.id)
      setOriginalImageUrl(resolveUrl(data.original_image_url || data.reference_image_url))
      setReferenceImageUrl(resolveUrl(data.reference_image_url))
      setCropTransform(data.crop_transform || null)
      // Deliberately NOT advancing `step` -- FocalFrameEditor mounts next,
      // still under step === 'capture', so this reads as one screen.
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save this sketch.')
    } finally {
      setSaving(false)
    }
  }

  function handleFocalSaved(updatedSketch) {
    if (updatedSketch?.reference_image_url) {
      setReferenceImageUrl(resolveUrl(updatedSketch.reference_image_url))
    }
    setStep('style')
  }

  function handleFocalSkip() {
    setStep('style')
  }

  // Since photos now upload immediately on pick (no Continue gate in
  // phase A), by the time a sketcher reaches FocalFrameEditor there's
  // already a real sketch row + uploaded file sitting on the server.
  // Retake needs to actually clean that up -- DELETE /api/sketches/{id}
  // (the same endpoint the Delete Sketch action on SketchWorkspaceModal.jsx
  // uses, which also removes the uploaded image file(s) off disk) --
  // rather than just resetting local state and orphaning it.
  async function handleRetake() {
    if (sketchId) {
      try {
        await api.delete(`/api/sketches/${sketchId}`)
      } catch {
        // Best-effort -- even if this fails, still let the sketcher
        // start over rather than getting stuck on a broken photo.
      }
    }
    if (preview) URL.revokeObjectURL(preview)
    setSketchId(null)
    setOriginalImageUrl(null)
    setReferenceImageUrl(null)
    setCropTransform(null)
    setPreview(null)
    setStyle(null)
    setAnalysis(null)
    setError(null)
  }

  async function handleStyleSelect(value) {
    if (analyzing) return
    setStyle(value)
    setAnalyzing(true)
    setError(null)
    try {
      await api.put(`/api/sketches/${sketchId}`, { style: value })
      const res = await fetch(referenceImageUrl || originalImageUrl)
      const blob = await res.blob()
      const form = new FormData()
      form.append('sketch_id', sketchId)
      form.append('style', value)
      form.append('image', blob, 'reference.jpg')
      const { data } = await api.post('/api/scene-analysis', form)
      setAnalysis(data)
      setStep('summary')
    } catch (err) {
      setError(err.response?.data?.detail || 'Scene analysis failed.')
    } finally {
      setAnalyzing(false)
    }
  }

  // Fires once GuidedPromptFlow has worked through every prepared prompt
  // (and the palette step), or the sketcher taps "Start Sketching Now" --
  // this is the moment they put the phone down and start drawing on
  // paper, so the wizard just closes and drops them back on their own
  // sketches feed rather than immediately prompting for a final photo
  // (that upload now lives as a standing option on SketchWorkspaceModal's
  // edit-mode view, reached later by tapping this sketch's card once
  // it's done -- see that page's `!latestCritique` upload panel).
  function handleFinishWizard() {
    navigate('/profile')
  }

  const stepIndex = STEPS.indexOf(step)

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/60 md:p-6">
      <div className="relative flex h-full w-full flex-col bg-black text-white md:h-[640px] md:w-[960px] md:max-h-[90vh] md:max-w-[95vw] md:overflow-hidden md:rounded-2xl">
        {/* title bar + progress bar + step description */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <button type="button" onClick={closeWizard} className="text-sm font-medium text-white/70 hover:text-white">
            Cancel
          </button>
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === stepIndex ? 'bg-white' : i < stepIndex ? 'bg-white/50' : 'bg-white/20'
                }`}
              />
            ))}
          </div>
          <span className="w-40 text-right text-xs font-medium text-white/40">New Sketch : {STEP_LABELS[step]}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 pt-3 md:px-8">
          {step === 'capture' && (
            <div className="animate-fade-in-up">
              {!sketchId ? (
                // Same two-panel shell FocalFrameEditor uses below (image
                // flush left, white controls right on md+, stacked on
                // mobile) -- kept visually seamless with phase B so
                // there's no jarring layout swap the instant the upload
                // finishes and FocalFrameEditor takes over in place.
                <div className="md:grid md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
                  <div className={`relative flex w-full items-center justify-center bg-black p-3 md:p-4 ${WIZARD_PANEL_HEIGHT_CLASS}`}>
                    {preview ? (
                      <>
                        {/* Marking happens on this same
                            raw photo next, and THAT component's own
                            frame-adjusting phase is where crop/pan/zoom
                            actually happens, once, after marking. */}
                        <img
                          src={preview}
                          alt=""
                          className={`aspect-[4/3] w-full bg-black object-contain md:h-full md:w-auto md:max-w-full ${WIZARD_IMAGE_MAX_WIDTH_CLASS}`}
                        />
                        {saving && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
                            <p className="animate-fade-in-up text-sm font-medium text-white">Uploading…</p>
                          </div>
                        )}
                      </>
                    ) : (
                      /* upload photo panel */
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-64 w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl bg-white/10 md:h-full"
                      >
                        <span className="text-4xl text-white/50">📷</span>
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.heic"
                      onChange={handleFile}
                      className="hidden"
                    />
                  </div>

                  <div className="flex flex-col justify-center gap-4 bg-white p-5 text-ink md:p-6">
                    <div>
                      {/* <h1 className="text-base font-bold tracking-tight">New sketch</h1> */}
                      <p className="text-xs text-ink/60">Add a photo and tell us what caught your attention.</p>
                    </div>
                    {preview && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={saving}
                        className="self-start rounded-full bg-ink/10 px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
                      >
                        Retake
                      </button>
                    )}
                    {error && <p className="text-sm text-accent">{error}</p>}
                  </div>
                </div>
              ) : (
                <FocalFrameEditor
                  sketchId={sketchId}
                  originalImageUrl={originalImageUrl}
                  initialCropTransform={cropTransform}
                  focalRegions={[]}
                  onSaved={handleFocalSaved}
                  onSkip={handleFocalSkip}
                  onRetake={handleRetake}
                  panelHeightPx={WIZARD_PANEL_HEIGHT_PX}
                />
              )}
            </div>
          )}

          {step === 'style' && (
            // Same two-panel shell as step 1 -- photo flush left/black,
            // controls (heading, style pills, status) in the white panel
            // right, so the wizard reads as one consistent surface across
            // steps instead of switching layouts mid-flow.
            <div className="animate-fade-in-up md:grid md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
              <div className={`flex w-full items-center justify-center bg-black p-3 md:p-4 ${WIZARD_PANEL_HEIGHT_CLASS}`}>
                {(referenceImageUrl || originalImageUrl) && (
                  <img
                    src={referenceImageUrl || originalImageUrl}
                    alt=""
                    className={`aspect-[4/3] w-full bg-black object-contain md:aspect-auto md:h-full md:w-auto md:max-w-full ${WIZARD_IMAGE_MAX_WIDTH_CLASS}`}
                  />
                )}
              </div>

              <div className="flex flex-col justify-center gap-4 bg-white p-5 text-ink md:p-6">
                <div>
                  <h1 className="text-base font-bold tracking-tight">Pick a style</h1>
                  <p className="mt-1 text-xs text-ink/60">This shapes how the AI looks at your scene.</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {STYLES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      disabled={analyzing}
                      onClick={() => handleStyleSelect(s.value)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50 ${
                        style === s.value ? 'bg-ink text-white' : 'bg-ink/10 text-ink/80 hover:bg-ink/20'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {analyzing && <p className="animate-fade-in-up text-sm text-ink/60">Looking at your scene…</p>}
                {error && <p className="text-sm text-accent">{error}</p>}
              </div>
            </div>
          )}

          {step === 'summary' && analysis && (
            <div className="animate-fade-in-up">
              <GuidedPromptFlow
                sketchId={sketchId}
                referenceImageUrl={referenceImageUrl || originalImageUrl}
                style={style}
                analysis={analysis}
                fullPage={false}
                onFinished={handleFinishWizard}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
