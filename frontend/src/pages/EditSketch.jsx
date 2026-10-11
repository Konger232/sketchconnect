import { useEffect, useRef, useState, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Button from '../components/common/Button'
import Icon from '../components/common/Icon'
import ConfirmDialog from '../components/common/ConfirmDialog'
import SketchModal from '../components/common/SketchModal'
import LocationSearchField from '../components/common/LocationSearchField'
import LocationMap from '../components/common/LocationMap'
import GuideStage, { useGuides } from '../components/analysis/GuideStage'
import StageStrip, { StripImage } from '../components/analysis/StageStrip'
import AIGuidance from '../components/analysis/AIGuidance'
import StylePicker from '../components/analysis/StylePicker'
import JourneyTrace from '../components/analysis/JourneyTrace'
import ProgressSteps from '../components/common/ProgressSteps'
import { useStagedProgress } from '../lib/useStagedProgress'
import { MarksLayer, markAtPoint } from '../components/analysis/Marks'
import { pointInOutline } from '../lib/markGeometry'
import { usePaintedRect } from '../lib/usePaintedRect'
import { useValueStudy } from '../lib/useValueStudy'
import { api } from '../lib/api'
import { runGuideAnalysis } from '../lib/guideAnalysis'
import { notifySketchesChanged } from '../lib/sketchEvents'
import { previewUrl } from '../lib/previewUrl'
import { STYLES, sceneTypeLabel } from '../data/styles'
import cameraWhite from '../assets/images/ico_camera_w.png'

const NOTE_LIMIT = 500

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'guide', label: 'Plan' }, // key stays 'guide' in code
  { key: 'feedback', label: 'Feedback' },
]

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${api.defaults.baseURL}${url}`
}

function locationText(location) {
  if (!location) return ''
  return location.label || `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`
}

/**
 * The sketch workspace (design handoff): the photo stage on the left, and
 * a panel on the right with the Details, Sparks and Feedback tabs.
 *
 * Opened from a sketch card (Edit Sketch), or straight after New Sketch's
 * scene analysis (router state: mode 'create' and the analysis). In create
 * mode the title is the AI's suggestion, so Details says so.
 *
 * Create mode is the end of New Sketch: the sketch only counts as created
 * at Start Sketching. Closing before that asks "Discard this sketch?", and
 * Discard deletes it. Edit mode opens on Details (or on Feedback once there
 * is a final sketch); closing with unsaved Details or an un-sent final
 * sketch photo asks "Discard changes?".
 *
 * Someone else's sketch opens read-only: the photo and its details.
 */
export default function EditSketch() {
  const { sketchId } = useParams()
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const [sketch, setSketch] = useState(null)
  const [loadError, setLoadError] = useState(null)
  // Create mode: straight from New Sketch, or a draft (never confirmed
  // with Start Sketching) opened again.
  const mode = routerLocation.state?.mode === 'create' || sketch?.is_draft ? 'create' : 'edit'
  const [tab, setTab] = useState(mode === 'create' ? 'guide' : 'details')
  // Phone: the panel is a bottom sheet over the photo (.sc-sheet). The
  // handle folds it down to the tabs, to see the whole photo; a tab opens it.
  const [sheetOpen, setSheetOpen] = useState(true)
  // The close dialog: 'sketch' (create mode: delete the sketch) or
  // 'changes' (edit mode: drop unsaved edits), or null.
  const [confirmingClose, setConfirmingClose] = useState(null)
  // The photo stage strip (StageStrip): show('plan' | 'photo' | 'final').
  const stripRef = useRef(null)

  // ===== STATE: GUIDE =====
  const [analysis, setAnalysis] = useState(routerLocation.state?.analysis || null)
  const [analyzing, setAnalyzing] = useState(false)
  const [guidanceError, setGuidanceError] = useState(null)
  const [aiSuggestion, setAiSuggestion] = useState(null)
  // Marks the current guided question points at (AIGuidance onHighlight).
  const [highlightIds, setHighlightIds] = useState([])
  // The guided question on screen (AIGuidance onPromptChange), and the spot
  // the sketcher marked on their lines while it shows (design doc, item 17).
  const [guideQuestion, setGuideQuestion] = useState(null)
  const [sketcherSpot, setSketcherSpot] = useState(null)
  // The last tap on the Plan while a question's options are tied to lines:
  // { id, n } (id null for a miss). AIGuidance picks the matching option.
  const [markTap, setMarkTap] = useState(null)
  // Taps on the suggested focal area (GuideStage), counted: AIGuidance
  // answers "Yes, add it" for each new one.
  const [suggestionTap, setSuggestionTap] = useState(0)
  // "Yes, add it" sent and not yet saved: the region_ref, so the stroke
  // shows (and the red area fades) without waiting for the server.
  const [adoptingRegion, setAdoptingRegion] = useState(null)
  // Parts of the scene picked by a tap as a guide answer ([{ id, points }]).
  const [answerOutlines, setAnswerOutlines] = useState([])
  const guides = useGuides()
  // An answer's overlay (such as values) stays on while the next question
  // shows, then turns off. With no rail, there is no other way to turn it
  // off. pendingOverlayRef holds the one just picked across the change.
  const pendingOverlayRef = useRef(null)
  useEffect(() => {
    guides.clearOverlays()
    if (pendingOverlayRef.current) guides.applyAction(pendingOverlayRef.current)
    pendingOverlayRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideQuestion])
  // A created sketch's Guide tab (review): no questions, only the scene
  // type for Help Quest. Kept stable so AIGuidance doesn't reset.
  // The footer slot for the Guide tab's Back / Next in review, so they sit
  // at the bottom right of the panel, like Start Sketching in create mode.
  const reviewAnalysis = useMemo(
    () => ({ scene_type: sketch?.scene_type, prepared_prompts: [] }),
    [sketch?.scene_type],
  )
  const valueStudy = useValueStudy(sketchId, analysis)

  // ===== STATE: DETAILS =====
  const [title, setTitle] = useState('')
  const [fieldNotes, setFieldNotes] = useState('')
  const [sketchLocation, setSketchLocation] = useState(null)
  const [editingLocation, setEditingLocation] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedJustNow, setSavedJustNow] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  // ===== STATE: FEEDBACK =====
  // The final sketch photo is only uploaded on "Get feedback"; the upload
  // starts the critique call in the background.
  const [finalFile, setFinalFile] = useState(null)
  const [finalPreview, setFinalPreview] = useState(null)
  // The style the sketcher drew in, picked with the final sketch. It
  // chooses the critique's persona. Starts from the sketch's saved style.
  const [finalStyle, setFinalStyle] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const libraryInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const pickRef = useRef(0) // latest final-sketch pick, see handleFinalFile
  const [planImgRef, planRect] = usePaintedRect()

  const isOwner = sketch?.is_owner === true
  const critiqueProgress = useStagedProgress({ count: 3, stepMs: 9000, active: sketch?.critique_status === 'pending' })

  // ===== LOAD =====

  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get(`/api/sketches/${sketchId}`)
        setSketch(data)
        // A draft continues New Sketch on Guide; a sketch with a final
        // sketch opens on its feedback.
        if (data.is_draft) setTab('guide')
        else if (routerLocation.state?.mode !== 'create' && data.final_sketch_url) setTab('feedback')
      } catch (err) {
        setLoadError(err.response?.status === 404 ? 'not_found' : 'error')
      }
    }
    load()
  }, [sketchId])

  function seedFields(from) {
    setTitle(from.title || '')
    setFieldNotes(from.field_notes || '')
    setSketchLocation(from.location || null)
    setEditingLocation(!from.location)
  }

  useEffect(() => {
    if (sketch) seedFields(sketch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch?.id])

  // The Guide tab needs the scene and marks analyses. The backend reuses
  // both cached results while the photo, framing and marks are unchanged,
  // so this is quick on a return visit. New Sketch passes them in already.
  useEffect(() => {
    // Only New Sketch asks questions. A created sketch's Guide tab lists its
    // saved answers, and its overlays come with the sketch itself.
    if (!sketch || !isOwner || mode !== 'create' || analysis || analyzing) return
    async function run() {
      setAnalyzing(true)
      setGuidanceError(null)
      try {
        const data = await runGuideAnalysis(sketchId)
        setAnalysis(data)
        // The backend fills a missing title from the AI's suggestion.
        const suggested = (data.suggested_title || '').trim().slice(0, 150)
        if (suggested && !sketch.title) setTitle((cur) => cur || suggested)
        setSketch((prev) => ({
          ...prev,
          title: prev.title || suggested || prev.title,
          scene_type: data.scene_type,
          focal_regions: data.focal_regions,
        }))
      } catch (err) {
        setGuidanceError(err.response?.data?.detail || 'Could not load the guide questions right now.')
      } finally {
        setAnalyzing(false)
      }
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch?.id, isOwner, mode])

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

  // Unsaved Details (title, field notes, location).
  function detailsDirty() {
    return (
      title !== (sketch.title || '') ||
      fieldNotes !== (sketch.field_notes || '') ||
      JSON.stringify(sketchLocation) !== JSON.stringify(sketch.location || null)
    )
  }

  // The close button: asks first when there is something to lose.
  function requestClose() {
    if (!sketch || !isOwner) return closeModal()
    if (mode === 'create') return setConfirmingClose('sketch')
    if (detailsDirty() || finalFile) return setConfirmingClose('changes')
    closeModal()
  }

  // Create mode's Discard: the sketch was never confirmed, so delete it
  // and everything saved with it.
  async function discardSketch() {
    setConfirmingClose(null)
    try {
      await api.delete(`/api/sketches/${sketchId}`)
    } catch {
      // Best-effort cleanup
    }
    closeModal()
  }

  // Opened as an overlay: go back. Direct visit: go to the home feed.
  function closeModal() {
    // The list underneath refetches: this modal may have created, titled
    // or restyled the sketch (lib/sketchEvents.js).
    notifySketchesChanged()
    if (routerLocation.state?.backgroundLocation) navigate(-1)
    else navigate('/')
  }

  // Pick an answer by its lines: a tap on the Plan while the question's
  // options are tied to marks.
  // A question that takes a tap as its answer (marks analysis,
  // tap_answer): a mark, else a scene object the AI traced, else a spot on
  // empty space. The spot shows with the sketcher's reticle. AIGuidance
  // adds or removes the row.
  function handlePickAt(p, aspect = 1) {
    const hit = markAtPoint(marks, p, aspect)
    if (guideQuestion?.tap_answer) {
      const objects = analysis?.marks_analysis?.scene_objects || []
      const obj = hit ? null : objects.find((o) => pointInOutline(p, o.points))
      const tap = hit ? { kind: 'mark', id: hit.id } : obj ? { kind: 'object', id: obj.id } : { kind: 'spot', id: null }
      setSketcherSpot(tap.kind === 'spot' ? { x: Math.round(p[0]), y: Math.round(p[1]), mark_ids: [] } : null)
      setMarkTap((prev) => ({ ...tap, point: { x: Math.round(p[0]), y: Math.round(p[1]) }, n: (prev?.n || 0) + 1 }))
      return
    }
    setMarkTap((prev) => ({ id: hit?.id ?? null, n: (prev?.n || 0) + 1 }))
  }

  // Start Sketching (create mode): confirms the new sketch, so it leaves
  // draft, shows in the feeds, and its answers are final. Saves any
  // unsaved Details first, then closes.
  const [confirmError, setConfirmError] = useState(null)
  async function handleStartSketching() {
    if (detailsDirty() && !(await handleSave())) {
      setTab('details') // show the save error instead of closing
      return
    }
    setConfirmError(null)
    try {
      await api.post(`/api/sketches/${sketchId}/confirm`)
    } catch (err) {
      setConfirmError(err.response?.data?.detail || 'Could not create this sketch. Try again.')
      return
    }
    closeModal()
  }

  // ===== DETAILS: SAVE AND DELETE =====

  // Returns whether it saved, for Start Sketching.
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
      setSavedJustNow(true)
      setTimeout(() => setSavedJustNow(false), 2000)
      return true
    } catch (err) {
      setSaveError(err.response?.data?.detail || 'Could not save these changes.')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleteError(null)
    try {
      await api.delete(`/api/sketches/${sketchId}`)
      notifySketchesChanged()
      navigate('/profile')
    } catch (err) {
      setConfirmingDelete(false)
      setDeleteError(err.response?.data?.detail || 'Could not delete this sketch.')
    }
  }

  // ===== FEEDBACK =====

  // HEIC photos need converting before they can be previewed (previewUrl).
  // pickRef drops a slow conversion if another photo was picked meanwhile.
  async function handleFinalFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const pick = ++pickRef.current
    setUploadError(null)
    try {
      const url = await previewUrl(f)
      if (pick !== pickRef.current) return URL.revokeObjectURL(url)
      if (finalPreview) URL.revokeObjectURL(finalPreview)
      setFinalFile(f)
      setFinalPreview(url)
      setFinalStyle((cur) => cur || sketch?.style || null)
    } catch {
      if (pick === pickRef.current) setUploadError('Could not open this photo. Try a JPEG or PNG.')
    }
  }

  function clearFinal() {
    pickRef.current++
    if (finalPreview) URL.revokeObjectURL(finalPreview)
    setFinalFile(null)
    setFinalPreview(null)
  }

  // Saves the final sketch. The backend then starts the critique call on
  // its own and returns right away with critique_status 'pending'.
  async function handleGetFeedback() {
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('image', finalFile)
      form.append('style', finalStyle)
      const { data } = await api.post(`/api/sketches/${sketchId}/final-sketch`, form)
      setSketch((prev) => ({ ...prev, ...data }))
      clearFinal()
      setTimeout(() => stripRef.current?.show('final'), 100) // once its panel exists
    } catch (err) {
      setUploadError(err.response?.data?.detail || 'Could not upload your sketch.')
    } finally {
      setUploading(false)
    }
  }

  // After a failed run, or for a sketch uploaded without feedback.
  async function handleRetryCritique() {
    try {
      const form = new FormData()
      form.append('sketch_id', sketchId)
      await api.post('/api/critique', form)
      setSketch((prev) => ({ ...prev, critique_status: 'pending' }))
    } catch {
      setUploadError('Could not start feedback right now.')
    }
  }

  // ===== RENDER: LOADING / ERROR =====

  const modalTitle = mode === 'create' ? 'New Sketch' : 'Edit Sketch'

  if (loadError || !sketch) {
    return (
      <SketchModal title={modalTitle} onClose={closeModal}>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-md text-sc-text3">
          {!loadError ? 'Loading…' 
            : loadError === 'not_found' ? "This sketch doesn't exist (or was deleted)." 
            : 'Could not load this sketch right now.'}
        </div>
      </SketchModal>
    )
  }

  const referenceImageUrl = resolveUrl(sketch.reference_image_url)
  const originalImageUrl = resolveUrl(sketch.original_image_url || sketch.reference_image_url)
  const finalSketchUrl = resolveUrl(sketch.final_sketch_url)
  const latestCritique = sketch.critiques?.[sketch.critiques.length - 1] || null
  const critiquePending = sketch.critique_status === 'pending'
  // Erased marks stay in the data for the critique but are never shown or counted.
  const marks = (sketch.marks || [])
    .filter((m) => !m.erased)
    // Marks saved before ids existed get m1, m2, ... in order, the same
    // fallback as the backend (mark_geometry.mark_id).
    .map((m, i) => (m.id ? m : { ...m, id: `m${i + 1}` }))
  const styleLabel = STYLES.find((s) => s.value === sketch.style)?.label
  const sceneLabel = sceneTypeLabel[sketch.scene_type]
  // "Detected from photo" only right after New Sketch, while it's still
  // the location the upload found.
  const locationUnchanged =
    mode === 'create' &&
    sketchLocation && sketch.location && sketchLocation.lat === sketch.location.lat && sketchLocation.lon === sketch.location.lon
  // While "Yes, add it" is being saved, the area's outline shows as the
  // stroke the server will add (same colour and width), so the red area
  // turns yellow at once. The saved stroke replaces it.
  const pendingRegion = adoptingRegion != null && !marks.some((m) => m.adopted_region === adoptingRegion)
    ? (sketch.focal_regions || [])[adoptingRegion] : null
  const pendingPoints = pendingRegion?.points?.length ? pendingRegion.points
    : Array.from({ length: Math.floor((pendingRegion?.contour_points || []).length / 2) },
      (_, k) => [pendingRegion.contour_points[2 * k], pendingRegion.contour_points[2 * k + 1]])
  const guideMarks = pendingPoints.length >= 3
    ? [...marks, {
        id: 'pending-adopt', source: 'prompted', adopted_region: adoptingRegion, width: 6.5,
        color: getComputedStyle(document.documentElement).getPropertyValue('--mark-color').trim() || '#fde68a',
        points: [...pendingPoints, pendingPoints[0]],
      }]
    : marks

  // ===== RENDER: PHOTO STAGE PANELS =====
  // Reference photo (the untouched upload), Plan (the framed photo with
  // focal points, marks and every guide), Final sketch. There's a Plan
  // panel once the sketcher reframed, placed focal points or drew marks.
  // Without one, the reference photo is the guide stage itself.
  const hasPlan =
    marks.length > 0 ||
    (!!sketch.original_image_url && sketch.original_image_url !== sketch.reference_image_url)
  const guideStage = (label) => ({
    key: 'plan',
    label,
    content: (
      <GuideStage
        imageUrl={referenceImageUrl}
        guides={guides}
        marks={guideMarks}
        perspective={sketch.perspective}
        focalRegions={sketch.focal_regions || []}
        proportions={sketch.proportions}
        valueStudy={isOwner ? valueStudy : null}
        aiSuggestion={tab === 'guide' ? aiSuggestion : null}
        highlightMarkIds={tab === 'guide' ? highlightIds : []}
        onPickAt={isOwner && tab === 'guide' && (guideQuestion?.tap_answer || guideQuestion?.option_mark_ids?.some((ids) => ids?.length)) ? handlePickAt : undefined}
        onSuggestionTap={isOwner && tab === 'guide' && (mode === 'create' || (sketch.plan_read && !sketch.final_sketch_url))
          ? () => setSuggestionTap((n) => n + 1) : undefined}
        suggestionAdded={aiSuggestion != null && guideMarks.some((m) => m.source === 'prompted' && m.adopted_region === aiSuggestion.region_ref)}
        answerOutlines={tab === 'guide' ? answerOutlines : []}
        spot={tab === 'guide' && guideQuestion ? sketcherSpot : null}
      />
    ),
  })
  const panels = [
    ...(hasPlan
      ? [
          { key: 'photo', label: 'Reference photo', content: <StripImage src={originalImageUrl} alt="Reference photo" /> },
          guideStage('Plan'),
        ]
      : [guideStage('Reference photo')]),
    ...(finalSketchUrl
      ? [{ key: 'final', label: 'Final sketch', content: <StripImage src={finalSketchUrl} alt="Your final sketch" /> }]
      : []),
  ]
  // ===== RENDER: PANELS =====

  const chips = (
    <div className="flex gap-2 overflow-hidden">
      {styleLabel && <span className="sc-chip">{styleLabel}</span>}
      {sceneLabel && <span className="sc-chip">{sceneLabel}</span>}
    </div>
  )

  const guidePanel = (
    <div className="sc-panel-body">
      {analyzing ? (
        <p className="sc-body animate-pulse">Reading your scene…</p>
      ) : guidanceError ? (
        <p className="text-base text-accent">{guidanceError}</p>
      ) : (
        <AIGuidance
          sketchId={sketchId}
          referenceImageUrl={referenceImageUrl}
          style={sketch.style}
          // A created sketch only needs the scene type, for Help Quest.
          analysis={mode === 'create' ? analysis : reviewAnalysis}
          review={mode !== 'create'}
          savedChoices={sketch.session_choices || []}
          onSuggestionChange={(suggestion) => {
            setAiSuggestion(suggestion)
            if (suggestion) stripRef.current?.show('plan') // the suggestion is drawn on the Plan
          }}
          onMarksChange={(saved) => setSketch((prev) => ({ ...prev, marks: saved }))}
          onAdoptPending={setAdoptingRegion}
          onPromptChange={setGuideQuestion}
          spot={sketcherSpot}
          onSpotClear={() => setSketcherSpot(null)}
          markTap={markTap}
          suggestionTap={suggestionTap}
          debugReport={Boolean(sketch.debug_report || analysis?.marks_analysis?.debug_report)}
          onAnswerObjects={setAnswerOutlines}
          // The plan read (design doc, item 25): from the run in New Sketch,
          // or saved with the sketch for Edit Sketch.
          planRead={mode === 'create' ? analysis?.plan_read : sketch.plan_read}
          // Bookmarks and added areas can change until the final sketch is uploaded.
          bookmarksLocked={Boolean(sketch.final_sketch_url)}
          focalSuggestions={(mode === 'create' ? analysis?.focal_suggestions : sketch.focal_suggestions) || []}
          // New Sketch: Back on the plan card reopens the strokes step with
          // this draft, so the sketcher can change the plan and read it again.
          onBackToStrokes={mode === 'create' ? () => navigate('/capture', {
            replace: true,
            state: { backgroundLocation: routerLocation.state?.backgroundLocation, resumeSketchId: sketchId },
          }) : undefined}
          onHighlight={(ids) => {
            setHighlightIds(ids)
            if (ids.length) stripRef.current?.show('plan') // the marks are drawn on the Plan
          }}
          onAction={(action) => {
            stripRef.current?.show('plan') // overlays draw on the Plan
            pendingOverlayRef.current = action
            guides.applyAction(action)
          }}
        />
      )}
    </div>
  )
  // Create mode: Start Sketching confirms the new sketch. Edit mode: Get
  // Feedback opens the Feedback tab, the next step after the plan.
  const guideTab = (
    <>
      {guidePanel}
      {mode === 'create' && (
        <div className="sc-footer">
          {confirmError && <span className="mr-auto text-base text-accent">{confirmError}</span>}
          <Button variant="action" className="ml-auto" onClick={handleStartSketching} disabled={saving}>
            Start Sketching
          </Button>
        </div>
      )}
      {mode === 'edit' && isOwner && (
        <div className="sc-footer">
          <Button variant="action" className="ml-auto" onClick={() => {
            setTab('feedback')
            if (finalSketchUrl) stripRef.current?.show('final')
          }}>
            Get Feedback
          </Button>
        </div>
      )}
    </>
  )

  const detailsPanel = (
    <>
      <div className="sc-panel-body gap-[18px]">
        {chips}

        <label className="flex flex-col gap-2">
          <span className="sc-field-label">Scene title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled sketch" className="sc-field" />
          {mode === 'create' && <span className="text-sm text-sc-text3">Suggested from your photo. Edit if needed.</span>}
        </label>

        <div className="flex flex-col gap-2">
          <span className="sc-field-label">Location</span>
          {sketchLocation && !editingLocation ? (
            <button
              type="button"
              onClick={() => setEditingLocation(true)}
              className="flex min-h-14 items-center gap-3 rounded-xl border-[1.5px] border-sc-strong bg-sc-raised py-2 pl-3.5 pr-3 text-left text-white"
            >
              <Icon name="location" size={20} className="text-sc-text3" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-lg font-medium">{locationText(sketchLocation)}</span>
                {locationUnchanged && <span className="text-sm text-sc-text3">Detected from photo</span>}
              </span>
              <span className="text-base font-bold text-sc-guide">Change</span>
            </button>
          ) : (
            <div className="overflow-hidden rounded-xl border-[1.5px] border-sc-strong bg-sc-raised">
              <p className="px-3.5 py-2.5 text-base text-sc-text2">
                {sketch.location ? 'Search for a place, or tap the map to move the pin.' : 'No location found in the photo. Search for a place, or tap the map to set the pin.'}
              </p>
              <div className="px-2.5 pb-2.5">
                <LocationSearchField location={sketchLocation} onLocationChange={setSketchLocation} dark />
              </div>
              <LocationMap
                key={sketchLocation?.label || 'map'}
                lat={sketchLocation?.lat}
                lon={sketchLocation?.lon}
                label={sketchLocation?.label}
                editable
                hint={false}
                height="h-[170px]"
                onLocationChange={setSketchLocation}
              />
              <div className="flex items-center gap-2.5 py-2 pl-3.5 pr-2">
                <span className="min-w-0 flex-1 truncate text-md font-semibold">{locationText(sketchLocation) || 'No place set'}</span>
                <button
                  type="button"
                  disabled={!sketchLocation}
                  onClick={() => setEditingLocation(false)}
                  className="h-11 whitespace-nowrap rounded-[10px] border-[1.5px] border-sc-guide px-3.5 text-base font-bold text-sc-guide disabled:opacity-40"
                >
                  Use this spot
                </button>
              </div>
            </div>
          )}
        </div>

        <label className="flex flex-col gap-2">
          <span className="flex items-center justify-between">
            <span className="sc-field-label">Field note (optional)</span>
            {fieldNotes && <span className="text-sm font-semibold text-sc-text3">{fieldNotes.length} / {NOTE_LIMIT}</span>}
          </span>
          <textarea
            value={fieldNotes}
            maxLength={NOTE_LIMIT}
            onChange={(e) => setFieldNotes(e.target.value)}
            placeholder="Weather, sounds, who stopped to watch, how long you stayed…"
            rows={4}
            className="sc-field resize-none leading-normal"
          />
        </label>

        {saveError && <p className="text-base text-accent">{saveError}</p>}
        {deleteError && <p className="text-base text-accent">{deleteError}</p>}
        
      </div>
      <div className="sc-footer">
        {savedJustNow && <span className="mr-auto text-base text-sc-text3">Saved</span>}
        <Button variant="secondaryOnDark" className="ml-auto" onClick={() => setTab('feedback')}>See feedback</Button>
        <Button variant="action" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </>
  )

  // Photo · Plan · Sketch, side by side, scrolling sideways.
  const imageStrip = (
    <div className="-mx-6 flex shrink-0 snap-x snap-mandatory scroll-px-6 gap-2.5 overflow-x-auto px-6 pb-0.5">
      <figure className="flex w-[150px] shrink-0 snap-start flex-col gap-1.5">
        <img src={referenceImageUrl} alt="Reference photo" className="h-[200px] w-full rounded-xl bg-black object-cover" />
        <figcaption className="text-base font-bold text-sc-text2">Photo</figcaption>
      </figure>
      <figure className="flex w-[150px] shrink-0 snap-start flex-col gap-1.5">
        <div className="relative h-[200px] w-full overflow-hidden rounded-xl bg-black">
          <img ref={planImgRef} src={referenceImageUrl} alt="Your plan" className="h-full w-full object-contain opacity-80" />
          {planRect && (
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute" style={planRect}>
              <MarksLayer marks={marks} />
            </svg>
          )}
        </div>
        <figcaption className="text-base font-bold text-sc-text2">Plan</figcaption>
      </figure>
      {finalSketchUrl && (
        <figure className="flex w-[150px] shrink-0 snap-start flex-col gap-1.5">
          <img src={finalSketchUrl} alt="Your sketch" className="h-[200px] w-full rounded-xl bg-black object-cover" />
          <figcaption className="text-base font-bold text-sc-text2">Sketch</figcaption>
        </figure>
      )}
    </div>
  )

  let feedbackBody
  let feedbackFooter
  if (critiquePending) {
    // Working. Doesn't block the other tabs.
    feedbackBody = (
      <>
        {finalSketchUrl && (
          // Scans while the AI reads it.
          <div className="sc-scan relative overflow-hidden rounded-2xl bg-black">
            <img src={finalSketchUrl} alt="Your sketch" className="max-h-[300px] w-full object-contain" />
          </div>
        )}
        <ProgressSteps
          heading="Reading your sketch…"
          current={critiqueProgress.current}
          seconds={critiqueProgress.seconds}
          steps={[
            { label: 'Matching it to your photo' },
            { label: 'Checking your plan' },
            { label: 'Writing your feedback' },
          ]}
        />
        <p className="sc-body">This can take a minute. You can switch tabs or keep drawing; the result waits here.</p>
      </>
    )
  } else if (finalPreview) {
    // Confirm the sketch photo before asking for feedback.
    feedbackBody = (
      <>
        <img src={finalPreview} alt="Your sketch" className="max-h-[360px] w-full rounded-2xl bg-black object-contain" />
        <p className="text-md text-sc-text2">Is the whole page flat and in focus? Crop out your hand and the table.</p>
        <div className="flex gap-2">
          <Button variant="choice" className="flex-1 text-center" onClick={() => cameraInputRef.current?.click()}>Retake</Button>
          <Button variant="choice" className="flex-1 text-center" onClick={() => libraryInputRef.current?.click()}>Choose another</Button>
        </div>
        <p className="text-md text-sc-text2">Which style did you sketch in? Feedback comes from an artist who works in it.</p>
        <StylePicker style={finalStyle} disabled={uploading} onSelectStyle={setFinalStyle} />
      </>
    )
    feedbackFooter = (
      <>
        <Button variant="secondaryOnDark" className="mr-auto" onClick={clearFinal} disabled={uploading}>Back</Button>
        <Button variant="action" onClick={handleGetFeedback} disabled={uploading || !finalStyle}>{uploading ? 'Uploading…' : 'Get feedback'}</Button>
      </>
    )
  } else if (finalSketchUrl) {
    // Result (or a failed / missing critique for this photo).
    feedbackBody = (
      <>
        {imageStrip}
        {latestCritique ? (
          <>
            <p className="whitespace-pre-line text-sm font-medium leading-normal text-white/90">{latestCritique.critique}</p>
            <JourneyTrace trace={latestCritique.decision_trace} />
          </>
        ) : sketch.critique_status === 'failed' ? (
          <p className="text-base text-accent">Could not get feedback this time.</p>
        ) : (
          <p className="sc-body">No feedback on this sketch yet.</p>
        )}
      </>
    )
    feedbackFooter = (
      <>
        <Button variant="secondaryOnDark" onClick={() => libraryInputRef.current?.click()}>New sketch photo</Button>
        {!latestCritique && <Button variant="action" onClick={handleRetryCritique}>Get feedback</Button>}
      </>
    )
  } else {
    // No sketch yet.
    feedbackBody = (
      <>
      <Button className="w-full h-full flex flex-1 p-0 block reset-button-styles"
        onClick={() => cameraInputRef.current?.click()}>
        <div className="sc-dropzone min-h-[260px]">
          <img src={cameraWhite} alt="camera" className="h-16 w-16 text-white" />
          <p className="font-heading text-xl font-semibold leading-snug">Photograph your finished sketch</p>
          <p className="max-w-[280px] text-md text-sc-text3">Feedback compares it with your photo and the plan you made.</p>
        </div>
        
        </Button>
        <p className="text-sm text-sc-text2">
          <b className="text-white">Your plan:</b>{' '}
          {marks.length === 1 ? '1 stroke' : `${marks.length} strokes`}
          {styleLabel && `, ${styleLabel}`}.
        </p>
      </>
    )
    feedbackFooter = (
      <>
        <Button variant="secondaryOnDark" onClick={() => libraryInputRef.current?.click()}>From library</Button>
        <Button variant="action" onClick={() => cameraInputRef.current?.click()}>Take photo</Button>
      </>
    )
  }

  const feedbackPanel = (
    <>
      <div className="sc-panel-body gap-3.5">
        {feedbackBody}
        {uploadError && <p className="text-base text-accent">{uploadError}</p>}
      </div>
      {feedbackFooter && <div className="sc-footer">{feedbackFooter}</div>}
    </>
  )

  // Someone else's sketch: its details, read-only.
  const viewerPanel = (
    <div className="sc-panel-body">
      {chips}
      <h2 className="font-heading text-xl font-bold text-white">{sketch.title || 'Untitled sketch'}</h2>
      <p className="text-base text-sc-text3">
        {sketch.owner?.display_name || 'Sketcher'}
        {sketch.captured_at && ` · ${new Date(sketch.captured_at).toLocaleDateString()}`}
      </p>
      {sketch.field_notes && <p className="whitespace-pre-line text-md text-sc-text2">{sketch.field_notes}</p>}
      {sketch.location && (
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-md text-white">
            <Icon name="location" size={16} className="text-sc-text3" />
            {locationText(sketch.location)}
          </span>
          <LocationMap lat={sketch.location.lat} lon={sketch.location.lon} label={sketch.location.label} height="h-[170px]" />
        </div>
      )}
    </div>
  )

  // ===== RENDER =====

  return (
    <SketchModal title={modalTitle} 
      onClose={requestClose}
      onDelete={mode === 'edit' && isOwner ? () => setConfirmingDelete(true) : undefined}>
      <ConfirmDialog
        open={confirmingClose === 'sketch'}
        title="Discard this sketch?"
        message="Closing now deletes this sketch: the photo, the framing, your plan, the scene analysis and your answers."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={discardSketch}
        onCancel={() => setConfirmingClose(null)}
      />
      <ConfirmDialog
        open={confirmingClose === 'changes'}
        title="Discard changes?"
        message="Your unsaved changes to this sketch will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => { setConfirmingClose(null); closeModal() }}
        onCancel={() => setConfirmingClose(null)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this sketch?"
        message="This removes its photo and any feedback, and can't be undone."
        confirmLabel="Delete sketch"
        cancelLabel="Keep it"
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
      <input ref={libraryInputRef} type="file" accept="image/*,.heic" onChange={handleFinalFile} className="hidden" />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFinalFile} className="hidden" />

      {/* ===== LEFT: PHOTO STAGE (sideways strip) ===== */}
      <StageStrip ref={stripRef} panels={panels} focusKey={tab === 'feedback' && finalSketchUrl ? 'final' : 'plan'} />

      {/* ===== RIGHT: TABS ===== */}
      <div className="sc-panel sc-sheet">
        <button
          type="button"
          className="sc-sheet-handle"
          aria-label={sheetOpen ? 'Fold the panel down' : 'Open the panel'}
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((v) => !v)}
        >
          <span />
        </button>
        {isOwner ? (
          <>
            <div className="sc-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="sc-tab"
                  onClick={() => { setTab(t.key); setSheetOpen(true) }}>
                  {t.label}
                </button>
              ))}
            </div>
            {/* Folded on a phone: only the handle and the tabs show. */}
            <div className={`flex min-h-0 flex-1 flex-col ${sheetOpen ? '' : 'max-md:hidden'}`}>
              {/* The Guide panel stays mounted so the question in progress
                  survives a trip to another tab. */}
              <div className={tab === 'guide' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>{guideTab}</div>
              {tab === 'details' && detailsPanel}
              {tab === 'feedback' && feedbackPanel}
            </div>
          </>
        ) : (
          <div className={`flex min-h-0 flex-1 flex-col ${sheetOpen ? '' : 'max-md:hidden'}`}>{viewerPanel}</div>
        )}
      </div>
    </SketchModal>
  )
}
