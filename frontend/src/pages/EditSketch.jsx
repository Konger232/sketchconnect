import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../components/common/AuthContext'
import Button from '../components/common/Button'
import Tag from '../components/common/Tag'
import LocationSearchField from '../components/common/LocationSearchField'
import LocationMap from '../components/common/LocationMap'
import PerspectiveLinesOverlay from '../components/analysis/PerspectiveLinesOverlay'
import RuleOfThirdsGrid from '../components/analysis/RuleOfThirdsGrid'
import GuidedPromptFlow from '../components/analysis/GuidedPromptFlow'
import icoPencilAi from '../assets/images/ico_pencil_ai.png'
import { sceneTypeLabel, STYLES } from '../data/styles'
import { Reticle } from '../components/analysis/FocalSpotPicker'
import { WIZARD_IMAGE_MAX_WIDTH_CLASS, WIZARD_PANEL_HEIGHT_CLASS } from '../lib/wizardLayout'
import { api } from '../lib/api'

const styleLabel = (v) => STYLES.find((s) => s.value === v)?.label || v

function toDatetimeLocalValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${api.defaults.baseURL}${url}`
}

// Shared outer shell so loading/error states still render as the same
// modal (with a working Close) rather than a bare, unstyled screen.
function Shell({ children }) {
  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/60 md:p-6">
      <div className="relative flex h-full w-full flex-col bg-black text-white md:h-[640px] md:w-[960px] md:max-h-[90vh] md:max-w-[95vw] md:overflow-hidden md:rounded-2xl">
        {children}
      </div>
    </div>
  )
}

export default function EditSketch() {
  const { sketchId } = useParams()
  const navigate = useNavigate()
  const routerLocation = useLocation()

  const [sketch, setSketch] = useState(null)
  const [loadError, setLoadError] = useState(null)

  // Metadata form fields -- re-seeded from the loaded sketch once, not on
  // every render, so in-progress edits survive an unrelated re-render.
  const [title, setTitle] = useState('')
  const [fieldNotes, setFieldNotes] = useState('')
  const [sketchLocation, setSketchLocation] = useState(null)
  const [capturedAt, setCapturedAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedJustNow, setSavedJustNow] = useState(false)

  // AI critique / final-sketch upload.
  const [finalFile, setFinalFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [critiqueError, setCritiqueError] = useState(null)
  // Once a sketch already has feedback, the upload area is collapsed
  // behind this -- so a returning sketcher sees their critique front and
  // center, and only re-opens the uploader to submit a newer version.
  const [requestingNewCritique, setRequestingNewCritique] = useState(false)

  // "Delete" has its own inline confirmation (no native window.confirm())
  // to match the rest of the app's UI rather than a browser dialog.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  // Left-panel analysis panels. 'photo' is the plain reference photo
  // (default), 'perspective' overlays Gemini's traced perspective lines,
  // 'value' swaps the photo out for a deterministic OpenCV value-study.
  // 'focal' for updating the previous selected focal points
  // 'prompts' for pulling up the AI Prompts again
  const [viewMode, setViewMode] = useState('photo')
  const [valueStudyImage, setValueStudyImage] = useState(null)
  const [loadingValueStudy, setLoadingValueStudy] = useState(false)

  // Scene analysis for the "Resume AI-guided questions" flow -- fetched
  // here (or reused if already fetched this session), then handed to
  // GuidedPromptFlow as a resolved prop; that component owns all of its
  // own prompt/Help Quest/overlay state internally.
  const [analysis, setAnalysis] = useState(null)
  const [analyzingPrompts, setAnalyzingPrompts] = useState(false)

  const {profile, displayName } = useAuth()
  // Does the logged-in user own this sketch?
  const isOwner = sketch?.is_owner === true

  async function load() {
    try {
      const { data } = await api.get(`/api/sketches/${sketchId}`)
      setSketch(data)
    } catch (err) {
      setLoadError(err.response?.status === 404 ? 'not_found' : 'error')
    }
  }

  useEffect(() => { load() }, [sketchId])

  // suppress the parent window scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    if (!sketch) return
    setTitle(sketch.title || '')
    setFieldNotes(sketch.field_notes || '')
    setSketchLocation(sketch.location || null)
    setCapturedAt(toDatetimeLocalValue(sketch.captured_at))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch?.id])

  // Closing goes back to wherever this was opened from when it was opened
  // as an overlay; a direct visit (no backgroundLocation, nothing to go
  // "back" to in this tab) falls back to the home feed instead.
  function handleClose() {
    if (routerLocation.state?.backgroundLocation) navigate(-1)
    else navigate('/')
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const { data } = await api.put(`/api/sketches/${sketchId}`, {
        title,
        field_notes: fieldNotes,
        // Always sent, even as `null` -- distinct from omitting the key
        // entirely, so clearing a location via LocationSearchField's X
        // button actually clears it server-side (see sketches.py's
        // update_sketch: `location` is the one field with a real "clear
        // it" affordance).
        location: sketchLocation,
        captured_at: capturedAt || undefined,
      })
      setSketch(data)
      setSavedJustNow(true)
      setTimeout(() => setSavedJustNow(false), 2000)
    } catch (err) {
      setSaveError(err.response?.data?.detail || 'Could not save these changes.')
    } finally {
      setSaving(false)
    }
  }

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

  async function submitCritique() {
    setSubmitting(true)
    setCritiqueError(null)
    try {
      const form = new FormData()
      form.append('sketch_id', sketchId)
      form.append('style', sketch.style)
      form.append('scene_type', sketch.scene_type)
      form.append('session_choices', '[]')
      form.append('help_quest_log', '[]')
      const latest = sketch.critiques?.[sketch.critiques.length - 1]
      if (latest) form.append('prior_review_summary', latest.critique)
      if (finalFile) form.append('final_sketch', finalFile)
      await api.post('/api/critique', form)
      const { data } = await api.get(`/api/sketches/${sketchId}`)
      setSketch(data)
      setFinalFile(null)
      setRequestingNewCritique(false)
    } catch (err) {
      setCritiqueError(err.response?.data?.detail || 'Could not get feedback right now.')
    } finally {
      setSubmitting(false)
    }
  }

  // FocalFrameEditor replaces this page's whole two-panel layout with its
  // own while it's open (see the render below) -- there's no separate
  // "retake" concept here (the photo's already final), so onRetake is
  // deliberately not passed.
  // function handleFocalSaved(updatedSketch) {
  //   setSketch(updatedSketch)
  //   setViewMode('photo')
  // }

  // function handleFocalSkip() {
  //   setViewMode('photo')
  // }

  // Dominant value shapes are computed on demand (deterministic OpenCV,
  // not cached server-side), so the first toggle-on fetches it and every
  // toggle after that reuses the already-fetched image.
  async function handleToggleValueShapes() {
    if (viewMode === 'value') {
      setViewMode('photo')
      return
    }
    if (!valueStudyImage) {
      setLoadingValueStudy(true)
      setCritiqueError(null)
      try {
        const { data } = await api.get(`/api/sketches/${sketchId}/value-study`)
        setValueStudyImage(data.valueStudyImage)
      } catch (err) {
        setCritiqueError(err.response?.data?.detail || 'Could not generate the value study right now.')
        setLoadingValueStudy(false)
        return
      }
      setLoadingValueStudy(false)
    }
    setViewMode('value')
  }

  async function handleStartPrompts() {
    setViewMode('prompts')
    if (analysis) return  // already fetched this session, don't re-call
    setAnalyzingPrompts(true)
    setCritiqueError(null)
    try {
      const res = await fetch(resolveUrl(sketch.reference_image_url))
      const blob = await res.blob()
      const form = new FormData()
      form.append('sketch_id', sketchId)
      form.append('style', sketch.style)
      form.append('image', blob, 'reference.jpg')
      const { data } = await api.post('/api/scene-analysis', form)
      setAnalysis(data)
    } catch (err) {
      setCritiqueError(err.response?.data?.detail || 'Could not resume AI guidance right now.')
      setViewMode('photo')
    } finally {
      setAnalyzingPrompts(false)
    }
  }

  function handleFinishPrompts() {
    setViewMode('photo')
  }

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

  const latestCritique = isOwner ? sketch.critiques?.[sketch.critiques.length - 1] : null
  const referenceImageUrl = resolveUrl(sketch.reference_image_url)
  const hasPerspectiveLines = (sketch.perspective_lines?.length || 0) > 0
  const hasFeedback = isOwner ? !!latestCritique : !!sketch.critique
  // style and scene tags
  const styleAndSceneTags = (sketch.style || sketch.scene_type) && (
    <div className="mt-1 flex gap-2">
      {sketch.style && <Tag>{styleLabel(sketch.style)}</Tag>}
      {sketch.scene_type && <Tag>{sceneTypeLabel[sketch.scene_type]}</Tag>}
    </div>
  )
  // Re-open FocalFrameEditor already showing what was confirmed last
  // time, rather than blank: the sketcher's own free-placed points seed
  // `initialOwnPoints`, and any Gemini suggestion already accepted
  // (source: "adopted", matched by its region_ref) is pre-marked
  // `adopted`/`asked` on the region itself -- see that component's own
  // docstring for why. Anything Gemini suggested but never resolved is
  // left `adopted: false, asked: false`, so it still surfaces through
  // the normal mark-asking flow for reconsideration.
  const initialOwnPoints = (sketch.focal_points || [])
    .filter((p) => p.source === 'own')
    .map((p) => ({ x: p.x, y: p.y }))
  const adoptedRegionRefs = new Set(
    (sketch.focal_points || [])
      .filter((p) => p.source === 'adopted' && p.region_ref != null)
      .map((p) => p.region_ref)
  )
  const focalRegionsForEditor = (sketch.focal_regions || []).map((r, i) => ({
    ...r,
    adopted: adoptedRegionRefs.has(i),
    asked: adoptedRegionRefs.has(i),
  }))

  return (
    <>
    <Shell>
      {/* Modal window title bar */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <Button variant="linkOnDark" type="button" onClick={handleClose} className="font-medium">
          Close
        </Button>
        <span className="text-sm font-semibold">Sketch</span>
        {isOwner ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-sm font-semibold text-white hover:text-white/80 disabled:text-white/40"
          >
            {saving ? 'Saving…' : savedJustNow ? 'Saved ✓' : 'Save'}
          </button>
        ) : (
          <span className="invisible text-sm font-medium" aria-hidden="true">Close</span>
        )}
      </div>

      {isOwner && saveError && (
        <div className="border-b border-white/10 bg-accent/10 px-4 py-2 text-xs text-accent">{saveError}</div>
      )}

      {viewMode === 'prompts' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 pt-3 md:overflow-hidden md:px-8">
          {analyzingPrompts || !analysis ? (
            <div className="flex h-full items-center justify-center text-sm text-white/50">Loading AI guidance…</div>
          ) : (
            <GuidedPromptFlow
              sketchId={sketchId}
              referenceImageUrl={referenceImageUrl}
              title={sketch.title}
              style={sketch.style}
              analysis={analysis}
              fullPage={false}
              onFinished={handleFinishPrompts}
            />
          )}
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] md:overflow-hidden">
        { 
          /* [X] Always the reference
            photo, never the final sketch -- perspective lines and the
            value study are analyses of the scene the sketcher is
            observing, not of their finished art. */
          /* Left reference photo panel + scaffold tools. */  
            }
        <div className={`flex w-full shrink-0 flex-col bg-black md:items-center ${WIZARD_PANEL_HEIGHT_CLASS}`}>
          
          <div className="relative min-h-0 w-full flex-1 overflow-hidden md:w-auto md:max-w-full">
            <img
              src={viewMode === 'value' && valueStudyImage ? valueStudyImage : referenceImageUrl}
              alt=""
              className={`h-full w-full object-cover md:w-auto md:max-w-full md:object-contain ${WIZARD_IMAGE_MAX_WIDTH_CLASS}`}
            />
            {viewMode === 'perspective' && <PerspectiveLinesOverlay lines={sketch.perspective_lines} />}
            {(sketch.focal_points || []).length > 0 && (
              <svg
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                {sketch.focal_points.map((p, i) => (
                  <Reticle key={i} x={p.x} y={p.y} />
                ))}
              </svg>
            )}
            <RuleOfThirdsGrid />
          </div>

          
          {/* Buttons : Original Photo | Perspective | Dominant Shapes */
            isOwner && (
            <div className="flex w-full flex-wrap gap-2 p-3">
              <Button variant="pill" active={viewMode === 'photo'} onClick={() => setViewMode('photo')} className="font-medium">
                Photo
              </Button>
              {hasPerspectiveLines && (
                <Button
                  variant="pill"
                  active={viewMode === 'perspective'}
                  onClick={() => setViewMode(viewMode === 'perspective' ? 'photo' : 'perspective')}
                  className="font-medium"
                >
                  Perspective lines
                </Button>
              )}
              <Button
                variant="pill"
                active={viewMode === 'value'}
                onClick={handleToggleValueShapes}
                disabled={loadingValueStudy}
                className="font-medium"
              >
                {loadingValueStudy ? 'Loading…' : 'Dominant value shapes'}
              </Button>
              <Button variant="pill" active={false} onClick={() => setViewMode('focal')} className="font-medium">
                Focal points
              </Button>
              
              {!hasFeedback && (
                <Button variant="pill" active={false} onClick={handleStartPrompts} className="font-medium">
                  Resume AI-guided questions
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Right Panel: one long scroll -- AI critique, title, location, field notes. */}
        <div className={`flex item-starts w-full flex-col gap-6 bg-gray-820 text-white md:overflow-y-auto pd:p-2`}>
            {/* Sketcher owner's avator and display name */}
            <div className="flex items-center gap-2 p-3 border-b border-white/20">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-mono text-[8px] text-white/60">photo</span>
                )}
              </div>
              <span className="text-sm font-semibold">{displayName}</span>
            </div>
            
            {/* Style + Scene */}
            <div className="pl-2 pr-2">
              {styleAndSceneTags}    
            </div>

            {/* Sketch Title. */}
            {isOwner ? (
              <label className="block pl-4 pr-4">
                <span className="text-sm font-semibold uppercase tracking-wide text-white/50 ml-2">Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Untitled Sketch"
                  className="mt-1 w-full rounded-lg border border-white/15 bg-gray-800 text-white/80 px-4 py-2.5 text-sm transition-colors focus:border-ink/40"
                />
              </label>
            ) : (
              <div>
                <h2 className="text-lg font-bold">{sketch.title || 'Untitled sketch'}</h2>
                <div className="mt-1 flex gap-2">
                  {sketch.style && <Tag>{styleLabel(sketch.style)}</Tag>}
                  {sketch.scene_type && <Tag>{sceneTypeLabel[sketch.scene_type]}</Tag>}
                </div>
              </div>
            )}

            {/* Location -- decoded from the photo's own GPS/EXIF data by
              default (Gemini reads the coordinates and names the city/
              country -- see scene_analysis.py's location_label), always
              in English. LocationSearchField lets the sketcher search for
              a different place instead, or clear it with its X button --
              no embedded map here; LocationMap.jsx is still used to show
              other sketchers' locations on the Home feed. */}
          <div className="pl-4 pr-4">
            <span className="text-sm font-semibold uppercase tracking-wide text-white/50 ml-2">Location</span>
            <div className="mt-1">
              {isOwner ? (
                <LocationSearchField location={sketchLocation} onLocationChange={setSketchLocation} dark />
              ) : sketch.location ? (
                <LocationMap lat={sketch.location.lat} lon={sketch.location.lon} label={sketch.title} />
              ) : (
                <p className="text-sm text-white/50">No location set.</p>
              )}
            </div>
          </div>

            

          

          {isOwner && (
            <label className="block pl-4 pr-4">
              <span className="text-sm font-semibold uppercase tracking-wide text-white/50 ml-2">Date &amp; time</span>
              <input
                type="datetime-local"
                value={capturedAt}
                onChange={(e) => setCapturedAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/15 bg-gray-800 text-white/80 px-4 py-2.5 text-sm transition-colors focus:border-ink/40"
              />
            </label>
          )}

          {/* Field notes. */}
          {isOwner ? (
            <label className="block pl-4 pr-4">
              <span className="text-sm font-semibold uppercase tracking-wide text-white/50 ml-2">Field notes</span>
              <textarea
                value={fieldNotes}
                onChange={(e) => setFieldNotes(e.target.value)}
                placeholder="Optional -- add this whenever you like"
                rows={4}
                className="mt-1 w-full rounded-lg border border-white/15 bg-gray-800 text-white/80 px-4 py-2.5 text-sm transition-colors focus:border-ink/40"
              />
            </label>
          ) : (
            sketch.field_notes && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-white/80 pl-4 pr-4">{sketch.field_notes}</p>
            )
          )}

          { /* Feedback -- either the existing critique (+ link to
              replace it) or the upload form, depending on hasFeedback/
              requestingNewCritique. Those two conditions are exact
              complements of each other under isOwner, so one gated
              block with a ternary body replaces what used to be two
              near-identical isOwner && (...) blocks each re-rendering
              the same heading + styleAndSceneTags. */
          isOwner && (
            <div className="pl-4 pr-4">
              <span className="text-sm font-semibold text-white/80">Feedback</span>
              {hasFeedback && !requestingNewCritique ? (
                <>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/70">{latestCritique.critique}</p>
                  <Button
                    variant="linkOnDark"
                    type="button"
                    onClick={() => setRequestingNewCritique(true)}
                    className="mt-2 font-medium underline"
                  >
                    Upload a newer version for more feedback
                  </Button>
                </>
              ) : (
                <>
                  <p className="mt-2 text-xs font-medium text-white/70">Upload your final sketch for feedback</p>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setFinalFile(e.target.files[0])}
                    className="mt-2 w-full text-xs"
                  />
                  {critiqueError && <p className="mt-2 text-xs text-accent">{critiqueError}</p>}
                  <Button size="sm" className="mt-3 w-full" disabled={submitting || !finalFile} onClick={submitCritique}>
                    {submitting ? 'Getting feedback…' : 'Get feedback'}
                  </Button>
                  {requestingNewCritique && (
                    <Button
                      variant="linkOnDark"
                      type="button"
                      onClick={() => setRequestingNewCritique(false)}
                      className="mt-2"
                    >
                      Cancel
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

          {/* 5. Delete -- swapped down here from the top bar; Save moved up
              to the top bar in its place (see the header above). */}
          {isOwner && (
            // <div className="mt-auto pt-2">
              <Button variant="danger" size="sm" className="w-full py-2 px-2.5 pl-2 pr-2 font-medium tracking-wide" 
              onClick={() => setConfirmingDelete(true)}>
                Delete sketch
              </Button>
            // </div>
          )}
        </div>
      </div>
      )}
    </Shell>

    {/* Delete confirmation as its own modal in front of the wizard, rather
        than an inline panel inside the scroll -- matches how a destructive
        confirmation should read (something you have to explicitly dismiss
        or act on) instead of being just another scrollable section.
        z-[1500], one above the wizard Shell's z-[1400], so it always sits
        on top of it. */}
    {isOwner && confirmingDelete && (
      <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-ink shadow-xl">
          <p className="text-sm">
            Delete this sketch? This removes its photo and any feedback, and can't be undone.
          </p>
          {deleteError && <p className="mt-2 text-sm text-accent">{deleteError}</p>}
          <div className="mt-4 flex gap-3">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={deleting}
              onClick={() => { setConfirmingDelete(false); setDeleteError(null) }}
            >
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
