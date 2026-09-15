import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Button from '../components/common/Button'
import Tag from '../components/common/Tag'
import MascotIcon from '../components/common/MascotIcon'
import LocationSearchField from '../components/common/LocationSearchField'
import LocationMap from '../components/common/LocationMap'
import PerspectiveLinesOverlay from '../components/analysis/PerspectiveLinesOverlay'
import FocalFrameEditor from '../components/analysis/FocalFrameEditor'
import icoPencilAi from '../assets/images/ico_pencil_ai.png'
import { sceneTypeLabel, STYLES } from '../data/styles'
import { WIZARD_IMAGE_MAX_WIDTH_CLASS, WIZARD_PANEL_HEIGHT_CLASS, WIZARD_PANEL_HEIGHT_PX } from '../lib/wizardLayout'
import { api } from '../lib/api'

const styleLabel = (v) => STYLES.find((s) => s.value === v)?.label || v

// Same helper EditInfoModal.jsx used -- renders a `datetime-local` input's
// expected "YYYY-MM-DDTHH:mm" string from an ISO timestamp, in the
// browser's own local time zone.
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

/**
 * Replaces the old three-way split of SketchDetailPage.jsx (a full page) +
 * EditInfoModal.jsx + AIFeedbackModal.jsx (two separate modals reached from
 * it) with one modal that does everything: reference photo + scaffold
 * tools on the left, and a single scrolling right-hand panel for AI
 * critique, title, location, field notes, and saving -- there's no more
 * reason to context-switch between "viewing" and "editing" a sketch, since
 * a sketch in progress is worked on the same way every time it's opened.
 *
 * Reached by clicking a sketch's card on the home feed (SketchCard.jsx),
 * which navigates here with `state: { backgroundLocation }` -- same
 * pattern Header.jsx uses for /capture (see App.jsx's Router) -- so the
 * feed stays mounted underneath and this renders as an overlay rather than
 * replacing the page. A direct visit/refresh (no backgroundLocation) still
 * works: it just renders as the only thing on the page, same as /capture
 * does when visited directly.
 *
 * Still a real, public route (no RequireAuth) -- non-owners can open any
 * sketch via a shared link. The backend tells us whether the current
 * requester owns this sketch via `is_owner`; owner-only controls (edit,
 * delete, critique upload, scaffold toggles) are gated on that flag, and
 * the backend never sends critique text to non-owners in the first place
 * (see sketches.py's get_sketch), so there's nothing to hide client-side.
 */
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

  // Left-panel reference aids. 'photo' is the plain reference photo
  // (default), 'perspective' overlays Gemini's traced perspective lines,
  // 'value' swaps the photo out for a deterministic OpenCV value-study.
  // Mutually exclusive -- the value-study is a different image entirely,
  // so overlaying lines on top of it doesn't make sense.
  const [viewMode, setViewMode] = useState('photo')
  const [valueStudyImage, setValueStudyImage] = useState(null)
  const [loadingValueStudy, setLoadingValueStudy] = useState(false)

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
  function handleFocalSaved(updatedSketch) {
    setSketch(updatedSketch)
    setViewMode('photo')
  }

  function handleFocalSkip() {
    setViewMode('photo')
  }

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

  // Shared outer shell so loading/error states still render as the same
  // modal (with a working Close) rather than a bare, unstyled screen.
  function Shell({ children }) {
    return (
      <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/60 md:p-6">
        {/* bg-black text-white -- matches CreateSketch.jsx's outer
            shell exactly (same box, same top-bar treatment), so Add and
            Edit read as one visual language rather than two. The right
            panel below still renders as its own white surface, same as
            CreateSketch's own white instructional panels do. */}
        <div className="relative flex h-full w-full flex-col bg-black text-white md:h-[640px] md:w-[960px] md:max-h-[90vh] md:max-w-[95vw] md:overflow-hidden md:rounded-2xl">
          {children}
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <Shell>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <button type="button" onClick={handleClose} className="text-sm font-medium text-white/70 hover:text-white">
            Close
          </button>
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
  // Shown under the "AI Critique" heading in both of its states below --
  // computed once here rather than duplicated in each branch. Style and
  // scene_type are always set together by the time a sketch reaches this
  // page (CreateSketch.jsx now guarantees that -- see parking-lot.md), so
  // in practice both tags always appear together, but each is still
  // checked independently in case an older sketch predates that guarantee.
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
        <button type="button" onClick={handleClose} className="text-sm font-medium text-white/70 hover:text-white">
          Close
        </button>
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

      {viewMode === 'focal' ? (
        <FocalFrameEditor
          sketchId={sketchId}
          originalImageUrl={resolveUrl(sketch.original_image_url) || referenceImageUrl}
          initialCropTransform={sketch.crop_transform}
          focalRegions={focalRegionsForEditor}
          initialOwnPoints={initialOwnPoints}
          onSaved={handleFocalSaved}
          onSkip={handleFocalSkip}
          panelHeightPx={WIZARD_PANEL_HEIGHT_PX}
        />
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
          {/* w-auto/max-w cap on md: and up, matching CreateSketch.jsx's
              and GuidedPromptFlow.jsx's own reference-photo treatment, so a
              wide/panoramic photo doesn't stretch edge-to-edge here while it's
              capped everywhere else. The wrapper shares the same md:w-auto
              cap as the <img> so it shrink-wraps to the image's own box --
              that's what keeps the perspective-lines overlay (sized to this
              wrapper) aligned with the visible photo instead of the full
              column width. */}
          <div className="relative min-h-0 w-full flex-1 overflow-hidden md:w-auto md:max-w-full">
            <img
              src={viewMode === 'value' && valueStudyImage ? valueStudyImage : referenceImageUrl}
              alt=""
              className={`h-full w-full object-cover md:w-auto md:max-w-full md:object-contain ${WIZARD_IMAGE_MAX_WIDTH_CLASS}`}
            />
            {viewMode === 'perspective' && <PerspectiveLinesOverlay lines={sketch.perspective_lines} />}
          </div>

          
          {/* Buttons : Original Photo | Perspective | Dominant Shapes */
            isOwner && (
            <div className="flex w-full flex-wrap gap-2 p-3">
              <button
                type="button"
                onClick={() => setViewMode('photo')}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === 'photo' ? 'bg-white text-ink' : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                Photo
              </button>
              {hasPerspectiveLines && (
                <button
                  type="button"
                  onClick={() => setViewMode(viewMode === 'perspective' ? 'photo' : 'perspective')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    viewMode === 'perspective' ? 'bg-white text-ink' : 'bg-white/10 text-white/70 hover:bg-white/20'
                  }`}
                >
                  Perspective lines
                </button>
              )}
              <button
                type="button"
                onClick={handleToggleValueShapes}
                disabled={loadingValueStudy}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                  viewMode === 'value' ? 'bg-white text-ink' : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                {loadingValueStudy ? 'Loading…' : 'Dominant value shapes'}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('focal')}
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/20"
              >
                Focal points
              </button>
              {/* AI guidance as just one more tool in this row, alongside
                  the other scene-analysis views -- rather than a
                  separate link in the metadata panel. Only relevant
                  before there's any feedback yet (once hasFeedback, the
                  guided-questions flow is already done). */}
              {!hasFeedback && (
                <button
                  type="button"
                  onClick={() => navigate(`/sketch-flow/${sketchId}`)}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/20"
                >
                  Resume AI-guided questions
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Panel: one long scroll -- AI critique, title, location, field notes. */}
        <div className={`flex w-full flex-col gap-6 bg-white p-4 text-ink md:overflow-y-auto md:p-2 ${WIZARD_PANEL_HEIGHT_CLASS}`}>

            { /* show the existing critique text + "Upload a newer version" link */
            isOwner && hasFeedback && !requestingNewCritique && (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <img src={icoPencilAi} alt="" className="h-5 w-5" />
                  <h3 className="text-sm font-semibold">AI Critique</h3>
                </div>
                {styleAndSceneTags}
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink/80">{latestCritique.critique}</p>
                <button
                  type="button"
                  onClick={() => setRequestingNewCritique(true)}
                  className="mt-2 text-xs font-medium text-ink/60 underline hover:text-ink"
                >
                  Upload a newer version for more feedback
                </button>
              </div>
            )}

            { /* show the upload form */
            isOwner && (!hasFeedback || requestingNewCritique) && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <img src={icoPencilAi} alt="" className="h-5 w-5" />
                <h3 className="text-sm font-semibold">AI Critique</h3>
              </div>
              {styleAndSceneTags}
              <p className="mt-2 text-xs font-medium text-ink/70">Upload your final sketch for feedback</p>
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
                <button
                  type="button"
                  onClick={() => setRequestingNewCritique(false)}
                  className="mt-2 text-xs text-ink/50 hover:text-ink"
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          {/* 2. Title. */}
          {isOwner ? (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled sketch"
                className="mt-1.5 w-full rounded-lg border border-black/15 px-4 py-2.5 text-sm transition-colors focus:border-ink/40"
              />
            </label>
          ) : (
            <div>
              <h1 className="text-lg font-bold">{sketch.title || 'Untitled sketch'}</h1>
              <div className="mt-1.5 flex gap-2">
                {sketch.style && <Tag>{styleLabel(sketch.style)}</Tag>}
                {sketch.scene_type && <Tag>{sceneTypeLabel[sketch.scene_type]}</Tag>}
              </div>
            </div>
          )}

          {/* 3. Location -- decoded from the photo's own GPS/EXIF data by
              default (Gemini reads the coordinates and names the city/
              country -- see scene_analysis.py's location_label), always
              in English. LocationSearchField lets the sketcher search for
              a different place instead, or clear it with its X button --
              no embedded map here; LocationMap.jsx is still used to show
              other sketchers' locations on the Home feed. */}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Location</span>
            <div className="mt-1.5">
              {isOwner ? (
                <LocationSearchField location={sketchLocation} onLocationChange={setSketchLocation} />
              ) : sketch.location ? (
                <LocationMap lat={sketch.location.lat} lon={sketch.location.lon} label={sketch.title} />
              ) : (
                <p className="text-sm text-ink/50">No location set.</p>
              )}
            </div>
          </div>

          {isOwner && (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Date &amp; time</span>
              <input
                type="datetime-local"
                value={capturedAt}
                onChange={(e) => setCapturedAt(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-black/15 px-4 py-2.5 text-sm transition-colors focus:border-ink/40"
              />
            </label>
          )}

          {/* 4. Field notes. */}
          {isOwner ? (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Field notes</span>
              <textarea
                value={fieldNotes}
                onChange={(e) => setFieldNotes(e.target.value)}
                placeholder="Optional -- add this whenever you like"
                rows={4}
                className="mt-1.5 w-full rounded-lg border border-black/15 px-4 py-2.5 text-sm transition-colors focus:border-ink/40"
              />
            </label>
          ) : (
            sketch.field_notes && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink/80">{sketch.field_notes}</p>
            )
          )}

          {/* 5. Delete -- swapped down here from the top bar; Save moved up
              to the top bar in its place (see the header above). */}
          {isOwner && (
            // <div className="mt-auto pt-2">
              <Button variant="danger" size="sm" className="w-full py-1 px-2.5 font-medium tracking-wide" 
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
