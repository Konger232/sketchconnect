import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Button from '../components/common/Button'
import LocationSearchField from '../components/common/LocationSearchField'
import LocationMap from '../components/common/LocationMap'
import { Reticle } from '../components/analysis/FocalSpotPicker'
import PerspectiveLinesOverlay from '../components/analysis/PerspectiveLinesOverlay'
import RuleOfThirdsGrid from '../components/analysis/RuleOfThirdsGrid'
import AIGuidance from '../components/analysis/AIGuidance'
import { WIZARD_IMAGE_MAX_WIDTH_CLASS, WIZARD_PANEL_HEIGHT_CLASS } from '../lib/wizardLayout'
import { api } from '../lib/api'
import icoEdit from '../assets/images/ico-pencil.png'

// Frontend name for the AI guided questions. One place to rename it.
const GUIDANCE_LABEL = 'Observation guide'

// Shared right-panel styles
const SECTION_CLASS = 'px-4'
const LABEL_CLASS = 'text-xs font-semibold uppercase tracking-wide text-white/50'
const INPUT_CLASS = 'mt-1 w-full rounded-lg border border-white/15 bg-gray-800 px-4 py-2.5 text-sm text-white/80 transition-colors focus:border-white/40'

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${api.defaults.baseURL}${url}`
}

// Outer modal shell, shared by the loading, error and loaded states.
function Shell({ children }) {
  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/60 md:p-6">
      <div className="relative flex h-full w-full flex-col bg-black text-white md:h-[640px] md:w-[960px] md:max-h-[90vh] md:max-w-[95vw] md:overflow-hidden md:rounded-2xl">
        {children}
      </div>
    </div>
  )
}

function Chevron({ up }) {
  return (
    <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${up ? '' : 'rotate-180'}`} aria-hidden="true">
      <path d="M5 12.5 10 7.5l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function EditSketch() {
  const { sketchId } = useParams()
  const navigate = useNavigate()
  const routerLocation = useLocation()

  const [sketch, setSketch] = useState(null)
  const [loadError, setLoadError] = useState(null)

  // ===== STATE: LEFT PANEL (slideshow + photo tools) =====
  // Which slide is showing: 'original' | 'framed' | 'final'. See SLIDES below.
  const [slideKey, setSlideKey] = useState('framed')
  // Photo tools apply to the framed slide only (owner only).
  const [showPerspective, setShowPerspective] = useState(false)
  const [showValueStudy, setShowValueStudy] = useState(false)
  const [valueStudyImage, setValueStudyImage] = useState(null)
  const [loadingValueStudy, setLoadingValueStudy] = useState(false)
  const [showFocalPoints, setShowFocalPoints] = useState(true)
  const [showRuleOfThirds, setShowRuleOfThirds] = useState(true)
  const [toolError, setToolError] = useState(null)

  // ===== STATE: RIGHT PANEL (owner only) =====
  // Title, field notes, location. Read-only until the owner taps Edit.
  // Seeded from the loaded sketch, and again on Edit / Cancel.
  const [isEditing, setIsEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [fieldNotes, setFieldNotes] = useState('')
  const [sketchLocation, setSketchLocation] = useState(null)

  // Upload final sketch (opens its own overlay). The upload starts the
  // critique call in the background. See CRITIQUE below.
  const [showUploadOverlay, setShowUploadOverlay] = useState(false)
  const [finalFile, setFinalFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  // Observation guide (AIGuidance), collapsed by default
  const [guidanceOpen, setGuidanceOpen] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [guidanceError, setGuidanceError] = useState(null)

  // Save
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedJustNow, setSavedJustNow] = useState(false)

  // Delete (confirmed in its own overlay)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const isOwner = sketch?.is_owner === true

  // ===== LOAD =====

  async function load() {
    try {
      const { data } = await api.get(`/api/sketches/${sketchId}`)
      setSketch(data)
    } catch (err) {
      setLoadError(err.response?.status === 404 ? 'not_found' : 'error')
    }
  }

  useEffect(() => { load() }, [sketchId])

  // Suppress the page scroll behind the modal
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function seedFields(from) {
    setTitle(from.title || '')
    setFieldNotes(from.field_notes || '')
    setSketchLocation(from.location || null)
  }

  useEffect(() => {
    if (sketch) seedFields(sketch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch?.id])

  // While the critique call runs in the background, re-fetch the sketch
  // every few seconds until its status leaves 'pending'.
  useEffect(() => {
    if (sketch?.critique_status !== 'pending') return
    const timer = setInterval(async () => {
      try {
        const { data } = await api.get(`/api/sketches/${sketchId}`)
        setSketch(data)
      } catch {
        // Keep polling. A dropped request shouldn't end the wait.
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [sketch?.critique_status, sketchId])

  // Opened as an overlay: go back. Direct visit: go to the home feed.
  function handleClose() {
    if (routerLocation.state?.backgroundLocation) navigate(-1)
    else navigate('/')
  }

  // ===== LEFT PANEL: DOMINANT VALUE SHAPES =====

  // Computed on demand (OpenCV, not cached server-side). Fetched on the
  // first toggle-on, reused after that.
  async function handleToggleValueShapes() {
    if (showValueStudy) {
      setShowValueStudy(false)
      return
    }
    if (!valueStudyImage) {
      setLoadingValueStudy(true)
      setToolError(null)
      try {
        const { data } = await api.get(`/api/sketches/${sketchId}/value-study`)
        setValueStudyImage(data.valueStudyImage)
      } catch (err) {
        setToolError(err.response?.data?.detail || 'Could not generate the value study right now.')
        return
      } finally {
        setLoadingValueStudy(false)
      }
    }
    setShowValueStudy(true)
  }

  // ===== RIGHT PANEL: EDIT MODE =====

  function handleEnterEdit() {
    seedFields(sketch)
    setSaveError(null)
    setIsEditing(true)
  }

  function handleCancelEdit() {
    seedFields(sketch)
    setSaveError(null)
    setIsEditing(false)
  }

  // ===== RIGHT PANEL: UPLOAD FINAL SKETCH =====

  function openUploadOverlay() {
    setFinalFile(null)
    setUploadError(null)
    setShowUploadOverlay(true)
  }

  // Saves the final sketch. The backend then starts the critique call on
  // its own and returns right away with critique_status 'pending'.
  async function handleUploadFinalSketch() {
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('image', finalFile)
      const { data } = await api.post(`/api/sketches/${sketchId}/final-sketch`, form)
      setSketch((prev) => ({ ...prev, ...data }))
      setSlideKey('final')
      setShowUploadOverlay(false)
    } catch (err) {
      setUploadError(err.response?.data?.detail || 'Could not upload your final sketch.')
    } finally {
      setUploading(false)
    }
  }

  // ===== RIGHT PANEL: OBSERVATION GUIDE =====

  // Opening runs the scene analysis call once per visit, then reuses it.
  async function handleToggleGuidance() {
    const opening = !guidanceOpen
    setGuidanceOpen(opening)
    if (!opening || analysis) return
    setAnalyzing(true)
    setGuidanceError(null)
    try {
      const form = new FormData()
      form.append('sketch_id', sketchId)
      form.append('style', sketch.style)
      const { data } = await api.post('/api/scene-analysis', form)
      setAnalysis(data)
    } catch (err) {
      setGuidanceError(err.response?.data?.detail || `Could not start the ${GUIDANCE_LABEL.toLowerCase()} right now.`)
    } finally {
      setAnalyzing(false)
    }
  }

  // ===== RIGHT PANEL: CRITIQUE (feedback on the whole journey) =====

  // Only needed after a failed run. A normal run starts from the upload.
  async function handleRetryCritique() {
    try {
      const form = new FormData()
      form.append('sketch_id', sketchId)
      await api.post('/api/critique', form)
      setSketch((prev) => ({ ...prev, critique_status: 'pending' }))
    } catch {
      // Status stays 'failed', so the Try again button stays visible.
    }
  }

  // ===== RIGHT PANEL: SAVE =====

  // Saves title, field notes and location. Guided answers and Help Quest
  // answers are saved as they happen. The final sketch is saved on upload.
  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const { data } = await api.put(`/api/sketches/${sketchId}`, {
        title,
        field_notes: fieldNotes,
        // Always sent, even as null, so clearing the location clears it.
        location: sketchLocation,
      })
      setSketch((prev) => ({ ...prev, ...data }))
      setIsEditing(false)
      setSavedJustNow(true)
      setTimeout(() => setSavedJustNow(false), 2000)
    } catch (err) {
      setSaveError(err.response?.data?.detail || 'Could not save these changes.')
    } finally {
      setSaving(false)
    }
  }

  // ===== RIGHT PANEL: DELETE =====

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.delete(`/api/sketches/${sketchId}`)
      navigate('/profile')
    } catch (err) {
      setDeleteError(err.response?.data?.detail || 'Could not delete this sketch.')
      setDeleting(false)
    }
  }

  // ===== RENDER: LOADING / ERROR =====

  if (loadError) {
    return (
      <Shell>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <Button variant="linkOnDark" type="button" onClick={handleClose} className="font-medium">
            Close
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-white/60">
          {loadError === 'not_found' ? "This sketch doesn't exist (or was deleted)." : 'Could not load this sketch right now.'}
        </div>
      </Shell>
    )
  }

  if (!sketch) {
    return (
      <Shell>
        <div className="flex flex-1 items-center justify-center text-sm text-white/50">Loading…</div>
      </Shell>
    )
  }

  const referenceImageUrl = resolveUrl(sketch.reference_image_url)
  const latestCritique = sketch.critiques?.[sketch.critiques.length - 1] || null
  const focalPoints = sketch.focal_points || []

  // ===== SLIDES =====
  // 1. Original upload (skipped when it was never cropped, so the same
  //    photo doesn't show twice).
  // 2. Framed photo: the sketcher's crop/pan/zoom, with their focal points
  //    drawn on top (on by default). Focal points are stored in this frame's
  //    coordinates, so they only line up here.
  // 3. Final sketch, once uploaded.
  const slides = [
    sketch.original_image_url && sketch.original_image_url !== sketch.reference_image_url && {
      key: 'original', label: 'Original photo', url: resolveUrl(sketch.original_image_url),
    },
    { key: 'framed', label: 'Your framing and focal points', url: referenceImageUrl },
    sketch.final_sketch_url && {
      key: 'final', label: 'Final sketch', url: resolveUrl(sketch.final_sketch_url),
    },
  ].filter(Boolean)
  const slideIndex = Math.max(0, slides.findIndex((sl) => sl.key === slideKey))
  const slide = slides[slideIndex]
  const onFramed = slide.key === 'framed'
  const critiquePending = sketch.critique_status === 'pending'

  // ===== RENDER =====

  return (
    <>
    <Shell>
      {/* ===== TOP ROW ===== */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <Button variant="linkOnDark" type="button" onClick={handleClose} className="font-medium">
          {/*=== Close Button ===*/}
          <svg class="w-4 h-4 text-gray-500" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
            <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
            <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>
            <g id="SVGRepo_iconCarrier">
              <path d="M195.2 195.2a64 64 0 0 1 90.496 0L512 421.504 738.304 195.2a64 64 0 0 1 90.496 90.496L602.496 512 828.8 738.304a64 64 0 0 1-90.496 90.496L512 602.496 285.696 828.8a64 64 0 0 1-90.496-90.496L421.504 512 195.2 285.696a64 64 0 0 1 0-90.496z"></path>
            </g>
          </svg>
        </Button>
        <span className="text-sm font-semibold">Edit Sketch</span>
          {!isOwner ? (
            <span className="invisible text-sm font-medium" aria-hidden="true">Close</span>
          ) : isEditing ? (
            <Button variant="linkOnDark" type="button" onClick={handleCancelEdit} className="font-medium">
              Cancel
            </Button>
          ) : (
            <button type="button" onClick={handleEnterEdit} aria-label="Edit" title="Edit" className="opacity-90 transition-opacity hover:opacity-100">
              {/* Black line icon, inverted to white for the dark top bar */}
              <img src={icoEdit} alt="Edit" className="h-7 w-7 invert" />
            </button>
          )}
      </div>{/* ===== END TOP ROW ===== */}

      <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] md:overflow-hidden">

        {/* ===== LEFT PANEL: slideshow + photo tools ===== */}
        <div className={`flex w-full shrink-0 flex-col bg-black md:items-center ${WIZARD_PANEL_HEIGHT_CLASS}`}>

          {/* --- Current slide --- */}
          <div className="relative min-h-0 w-full flex-1 overflow-hidden md:w-auto md:max-w-full">
            <img
              key={slide.key}
              src={onFramed && showValueStudy && valueStudyImage ? valueStudyImage : slide.url}
              alt={slide.label}
              className={`h-full w-full animate-fade-in-scale object-cover md:w-auto md:max-w-full md:object-contain ${WIZARD_IMAGE_MAX_WIDTH_CLASS}`}
            />

            {/* --- Framed slide overlays --- */}
            {onFramed && (
              <>
                {/* Focal points: on by default, toggled below */}
                {showFocalPoints && focalPoints.length > 0 && (
                  <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    {focalPoints.map((p, i) => (
                      <Reticle key={i} x={p.x} y={p.y} />
                    ))}
                  </svg>
                )}
                {showPerspective && <PerspectiveLinesOverlay lines={sketch.perspective_lines} />}
                {showRuleOfThirds && <RuleOfThirdsGrid />}
              </>
            )}

            {/* --- Prev / next --- */}
            {slideIndex > 0 && (
              <button
                type="button"
                onClick={() => setSlideKey(slides[slideIndex - 1].key)}
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/30 text-lg text-white hover:bg-black/80"
              >
                ‹
              </button>
            )}
            {slideIndex < slides.length - 1 && (
              <button
                type="button"
                onClick={() => setSlideKey(slides[slideIndex + 1].key)}
                aria-label="Next photo"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/30 text-lg text-white hover:bg-black/80"
              >
                ›
              </button>
            )}
          </div>

          {/* --- Caption + dots --- */}
          <div className="flex w-full items-center justify-between px-3 pt-2 text-xs text-white/60">
            <span>{slide.label}</span>
            {slides.length > 1 && (
              <div className="flex gap-1.5">
                {slides.map((sl) => (
                  <button
                    key={sl.key}
                    type="button"
                    onClick={() => setSlideKey(sl.key)}
                    aria-label={sl.label}
                    className={`h-1.5 w-1.5 rounded-full ${sl.key === slide.key ? 'bg-white' : 'bg-white/30'}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* --- Photo tool toggles (owner only, framed slide only) --- */}
          {isOwner && onFramed && (
            <div className="flex w-full flex-wrap gap-2 p-3">
              {sketch.perspective_lines?.length > 0 && (
                <Button variant="pill" active={showPerspective} onClick={() => setShowPerspective((v) => !v)}>
                  Perspective lines
                </Button>
              )}
              <Button variant="pill" active={showValueStudy} onClick={handleToggleValueShapes} disabled={loadingValueStudy}>
                {loadingValueStudy ? 'Loading…' : 'Dominant value shapes'}
              </Button>
              <Button variant="pill" active={showFocalPoints} onClick={() => setShowFocalPoints((v) => !v)} disabled={focalPoints.length === 0}>
                Focal points
              </Button>
              <Button variant="pill" active={showRuleOfThirds} onClick={() => setShowRuleOfThirds((v) => !v)}>
                Rule of thirds
              </Button>
              {toolError && <p className="w-full text-xs text-accent">{toolError}</p>}
            </div>
          )}
        </div>{/* ===== END LEFT PANEL ===== */}

        {/* ===== RIGHT PANEL: owner edits, everyone else views ===== */}
        <div className="flex w-full flex-col gap-4 bg-gray-900 pb-6 text-white md:overflow-y-auto">

          {/* --- Avatar + display name (the sketch owner's) --- */}
          <div className="flex items-center gap-2 border-b border-white/20 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">
              {sketch.owner?.avatar_url ? (
                <img src={sketch.owner.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-mono text-[8px] text-white/60">photo</span>
              )}
            </div>
            <span className="text-sm font-semibold">{sketch.owner?.display_name || 'Sketcher'}</span>
          </div>

          {!isOwner ? (
            <>
              {/* ===== VIEWER ===== */}

              {/* --- Title --- */}
              <h2 className={`${SECTION_CLASS} text-lg font-bold text-white/80`}>{sketch.title || 'Untitled sketch'}</h2>

              {/* --- Date and time --- */}
              <div className={SECTION_CLASS}>
                <span className={LABEL_CLASS}>Date &amp; time</span>
                <p className="mt-1 text-sm text-white/80">
                  {sketch.captured_at ? new Date(sketch.captured_at).toLocaleString() : 'Not set'}
                </p>
              </div>

              {/* --- Location --- */}
              <div className={SECTION_CLASS}>
                <span className={LABEL_CLASS}>Location</span>
                <div className="mt-1">
                  {sketch.location ? (
                    <LocationMap lat={sketch.location.lat} lon={sketch.location.lon} label={sketch.title} />
                  ) : (
                    <p className="text-sm text-white/50">No location set.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* ===== OWNER ===== */}

              {/* --- Title + field notes (read-only until Edit) --- */}
              {isEditing ? (
                <>
                  <label className={`block ${SECTION_CLASS}`}>
                    <span className={LABEL_CLASS}>Title</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled sketch" className={INPUT_CLASS} />
                  </label>
                  <label className={`block ${SECTION_CLASS}`}>
                    <span className={LABEL_CLASS}>Field notes</span>
                    <textarea
                      value={fieldNotes}
                      onChange={(e) => setFieldNotes(e.target.value)}
                      placeholder="Optional. Add this whenever you like."
                      rows={4}
                      className={INPUT_CLASS}
                    />
                  </label>
                </>
              ) : (
                <>
                  <h2 className={`${SECTION_CLASS} text-lg font-bold text-white/80`}>{sketch.title || 'Untitled sketch'}</h2>
                  {sketch.field_notes && (
                    <p className={`${SECTION_CLASS} whitespace-pre-line text-sm leading-relaxed text-white/80`}>{sketch.field_notes}</p>
                  )}
                </>
              )}

              {/* --- Location (read-only until Edit) --- */}
              {/* Prefilled from the photo's GPS data. In Edit, search to
                  change it, or clear it with the X. */}
              <div className={SECTION_CLASS}>
                <span className={LABEL_CLASS}>Location</span>
                <div className="mt-1">
                  {isEditing ? (
                    <LocationSearchField location={sketchLocation} onLocationChange={setSketchLocation} dark />
                  ) : sketch.location ? (
                    <LocationMap lat={sketch.location.lat} lon={sketch.location.lon} label={sketch.title} />
                  ) : (
                    <p className="text-sm text-white/50">No location set.</p>
                  )}
                </div>
              </div>

              {/* --- Final sketch: upload (shown in the slideshow) --- */}
              <div className={SECTION_CLASS}>
                <span className={LABEL_CLASS}>Final sketch</span>
                <Button variant="outlineOnDark" size="sm" className="mt-2 w-full" onClick={openUploadOverlay} disabled={critiquePending}>
                  {sketch.final_sketch_url ? 'Upload a newer final sketch' : 'Upload final sketch'}
                </Button>
              </div>

              {/* --- Observation guide (AIGuidance), collapsible --- */}
              <div className="border-y border-white/20">
                <button
                  type="button"
                  onClick={handleToggleGuidance}
                  aria-expanded={guidanceOpen}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
                >
                  {GUIDANCE_LABEL}
                  <Chevron up={guidanceOpen} />
                </button>
                {guidanceOpen && (
                  <div className="animate-fade-in-up">
                    {analyzing ? (
                      <p className="px-4 pb-3 text-sm text-white/50">Looking at your scene…</p>
                    ) : guidanceError ? (
                      <p className="px-4 pb-3 text-xs text-accent">{guidanceError}</p>
                    ) : (
                      <AIGuidance
                        sketchId={sketchId}
                        referenceImageUrl={referenceImageUrl}
                        style={sketch.style}
                        analysis={analysis}
                        onFinished={() => setGuidanceOpen(false)}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* --- Feedback (critique call, runs in the background) --- */}
              <div className={SECTION_CLASS}>
                <span className={LABEL_CLASS}>Feedback</span>
                {critiquePending ? (
                  <p className="mt-2 animate-pulse text-sm text-white/60">Reviewing your whole journey. This can take a minute…</p>
                ) : sketch.critique_status === 'failed' ? (
                  <div className="mt-2">
                    <p className="text-xs text-accent">Could not get feedback this time.</p>
                    <Button variant="outlineOnDark" size="sm" className="mt-2" onClick={handleRetryCritique}>
                      Try again
                    </Button>
                  </div>
                ) : latestCritique ? (
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/70">{latestCritique.critique}</p>
                ) : (
                  <p className="mt-2 text-xs text-white/50">No feedback yet. Upload your final sketch to get feedback on your whole journey.</p>
                )}
              </div>

              {/* --- Save + delete (Edit only) --- */}
              {isEditing && (
                <>
                  <div className={SECTION_CLASS}>
                    {saveError && <p className="mb-2 text-xs text-accent">{saveError}</p>}
                    <Button variant="primaryOnDark" size="sm" className="w-full" onClick={handleSave} disabled={saving}>
                      {saving ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                  <div className={SECTION_CLASS}>
                    <Button variant="danger" size="sm" className="w-full font-medium" onClick={() => setConfirmingDelete(true)}>
                      Delete sketch
                    </Button>
                  </div>
                </>
              )}
              {savedJustNow && <p className={`${SECTION_CLASS} text-xs text-white/60`}>Saved ✓</p>}
            </>
          )}
        </div>{/* ===== END RIGHT PANEL ===== */}
      </div>
    </Shell>

    {/* ===== OVERLAY: UPLOAD FINAL SKETCH ===== */}
    {/* z-[1500] sits above the Shell's z-[1400]. */}
    {isOwner && showUploadOverlay && (
      <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-ink shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Upload your final sketch</h3>
            <button type="button" onClick={() => setShowUploadOverlay(false)} aria-label="Close" className="text-ink/50 hover:text-ink">
              ×
            </button>
          </div>
          <p className="mt-2 text-xs text-ink/60">
            Get feedback on your finished piece, based on your entire journey with this sketch.
          </p>
          <input type="file" accept="image/*" onChange={(e) => setFinalFile(e.target.files[0])} className="mt-3 w-full text-xs" />
          {uploadError && <p className="mt-2 text-xs text-accent">{uploadError}</p>}
          <Button size="sm" className="mt-3 w-full" disabled={uploading || !finalFile} onClick={handleUploadFinalSketch}>
            {uploading ? 'Uploading…' : 'Upload and get feedback'}
          </Button>
        </div>
      </div>
    )}

    {/* ===== OVERLAY: DELETE CONFIRMATION ===== */}
    {isOwner && confirmingDelete && (
      <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-ink shadow-xl">
          <p className="text-sm">Delete this sketch? This removes its photo and any feedback, and can't be undone.</p>
          {deleteError && <p className="mt-2 text-sm text-accent">{deleteError}</p>}
          <div className="mt-4 flex gap-3">
            <Button variant="outline" size="sm" className="flex-1" disabled={deleting} onClick={() => { setConfirmingDelete(false); setDeleteError(null) }}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" className="flex-1" disabled={deleting} onClick={handleDelete}>
              {deleting ? 'Deleting…' : 'Delete sketch'}
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
