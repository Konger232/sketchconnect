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
import { MarksLayer, markAtPoint } from '../components/analysis/Marks'
import { pointInOutline } from '../lib/markGeometry'
import { useValueStudy } from '../lib/useValueStudy'
import { api } from '../lib/api'
import ValuePanel from '../components/analysis/ValuePanel'
import ColorPanel from '../components/analysis/ColorPanel'
import { DEFAULT_SHAPES, readMask } from '../lib/gamutMask'
import { SamplePhoto, MaskedPhoto } from '../components/analysis/ColorStage'
import SwatchOverlay from '../components/analysis/SwatchOverlay'
import RecipeStrip from '../components/analysis/RecipeStrip'
import { kitPaintList, starterPaints } from '../data/paints'
import { runGuideAnalysis } from '../lib/guideAnalysis'
import { notifySketchesChanged } from '../lib/sketchEvents'
import { STYLES, sceneTypeLabel } from '../data/styles'
import { useSheetDrag } from '../lib/useSheetDrag'

const NOTE_LIMIT = 500

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'guide', label: 'Composition' }, // key stays 'guide' in code
  { key: 'value', label: 'Value' },
  { key: 'color', label: 'Color' },
]

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${api.defaults.baseURL}${url}`
}

function locationText(location) {
  if (!location) return ''
  return location.label || `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`
}

// Who sees a shared sketch (backend app/core/visibility.py).
const VISIBILITY = [
  { key: 'members', label: 'All sketchers', note: 'Every signed-in sketcher can see it. Visitors see only a small part of the final.' },
  { key: 'followers', label: 'My followers', note: 'Only sketchers who follow you can see it.' },
  { key: 'private', label: 'Only me', note: 'No one else can see it.' },
]
const GLAZE_URL = 'https://glaze.cs.uchicago.edu/'

/**
 * The sketch workspace (design handoff): the photo stage on the left, and
 * a panel on the right with the Details and Plan tabs. Uploads and
 * feedback live on the SketchDetail page (design doc, item 38).
 *
 * Opened from a sketch card (Edit Sketch), or straight after New Sketch's
 * scene analysis (router state: mode 'create' and the analysis). In create
 * mode the title is the AI's suggestion, so Details says so.
 *
 * Create mode is the end of New Sketch. Closing it asks "Discard this
 * sketch?", and Discard deletes it. Start Sketching shows once the plan
 * read is back, and opens the sketch's SketchDetail page. The sketch is
 * shared with others once it has a final sketch (design doc, item 30).
 * Edit mode opens on Details, which save as you type. The plan is
 * read-only once the final sketch is in.
 *
 * Someone else's sketch opens read-only: the photo and its details.
 */
export default function EditSketch() {
  const { sketchId } = useParams()
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const [sketch, setSketch] = useState(null)
  const [loadError, setLoadError] = useState(null)
  // Create mode: straight from New Sketch. Any other opening is Edit
  // Sketch, including a sketch left in New Sketch without Discard.
  const mode = routerLocation.state?.mode === 'create' ? 'create' : 'edit'
  // A page can ask for a tab (state.tab; the Sketch page asks for Details).
  const askedTab = routerLocation.state?.tab
  const [tab, setTab] = useState(askedTab || (mode === 'create' ? 'guide' : 'details'))
  // Phone: the panel is a bottom sheet over the photo (.sc-sheet). The
  // handle folds it down to the tabs, to see the whole photo; a tab opens it.
  const [sheetOpen, setSheetOpen] = useState(true)
  const sheet = useSheetDrag(sheetOpen, setSheetOpen)
  // The close dialog: 'sketch' (create mode: delete the sketch), or null.
  const [confirmingClose, setConfirmingClose] = useState(null)
  // The photo stage strip (StageStrip): show('plan' | 'photo' | 'final').
  const stripRef = useRef(null)

  // ===== STATE: VALUE AND COLOR (design doc, item 37) =====
  const [valueLevels, setValueLevels] = useState(5)
  const [valueStudies, setValueStudies] = useState({}) // { levels: study }
  const [valueError, setValueError] = useState(null)
  const [maskShapes, setMaskShapes] = useState(DEFAULT_SHAPES)
  const [colorSample, setColorSample] = useState(null)
  const [swatches, setSwatches] = useState([]) // tiles collected from the wheel: [{ h, c, hex }]
  const [kitPaints, setKitPaints] = useState(null) // null until loaded
  // The paints the recipes mix from: the kit, or the starter palette.
  const mixPaints = useMemo(() => (kitPaints?.length ? kitPaints : starterPaints()), [kitPaints])
  const maskSaveRef = useRef(null)

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
  const [visibility, setVisibility] = useState('members') // who sees it once shared
  const [glazed, setGlazed] = useState(false)
  const [sketchLocation, setSketchLocation] = useState(null)
  const [editingLocation, setEditingLocation] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedJustNow, setSavedJustNow] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(null)


  const isOwner = sketch?.is_owner === true

  // ===== LOAD =====

  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get(`/api/sketches/${sketchId}`)
        setSketch(data)
        if (data.value_levels) setValueLevels(data.value_levels)
        setMaskShapes(readMask(data.gamut_mask) || DEFAULT_SHAPES)
        setSwatches(data.gamut_mask?.swatches || [])
      } catch (err) {
        setLoadError(err.response?.status === 404 ? 'not_found' : 'error')
      }
    }
    load()
  }, [sketchId])

  function seedFields(from) {
    setTitle(from.title || '')
    setFieldNotes(from.field_notes || '')
    setVisibility(from.visibility || 'members')
    setGlazed(Boolean(from.glazed))
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

  // Unsaved Details (title, field notes, location).
  function detailsDirty() {
    return (
      title !== (sketch.title || '') ||
      fieldNotes !== (sketch.field_notes || '') ||
      visibility !== (sketch.visibility || 'members') ||
      glazed !== Boolean(sketch.glazed) ||
      JSON.stringify(sketchLocation) !== JSON.stringify(sketch.location || null)
    )
  }

  // The close button: asks first when there is something to lose.
  function requestClose() {
    if (!sketch || !isOwner) return closeModal()
    if (mode === 'create') return setConfirmingClose('sketch')
    // Details autosave; a change still waiting is saved before closing.
    if (detailsDirty()) {
      clearTimeout(detailsTimer.current)
      handleSave().then((ok) => (ok ? closeModal() : setTab('details')))
      return
    }
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

  // Start Sketching (create mode): saves any unsaved Details, then opens
  // the sketch's SketchDetail page, where its uploads go (design doc,
  // item 38).
  async function handleStartSketching() {
    if (detailsDirty() && !(await handleSave())) {
      setTab('details') // show the save error instead of closing
      return
    }
    notifySketchesChanged()
    navigate(`/sketches/${sketchId}`, { replace: true })
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
        visibility,
        glazed,
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
      navigate('/')
    } catch (err) {
      setConfirmingDelete(false)
      setDeleteError(err.response?.data?.detail || 'Could not delete this sketch.')
    }
  }

  // ===== VALUE AND COLOR =====

  // The value study for the picked number of values, fetched once each.
  useEffect(() => {
    if (tab !== 'value' || !sketch?.is_owner || valueStudies[valueLevels]) return
    setValueError(null)
    api.get(`/api/sketches/${sketchId}/value-study`, { params: { levels: valueLevels, scale: true } })
      .then(({ data }) => setValueStudies((m) => ({ ...m, [valueLevels]: data })))
      .catch(() => setValueError('Could not read the values right now.'))
  }, [tab, valueLevels, sketch?.is_owner]) // eslint-disable-line react-hooks/exhaustive-deps

  // Details autosave: a moment after typing stops, like the Value and
  // Color tabs save as they change.
  const detailsTimer = useRef(null)
  useEffect(() => {
    if (!sketch || !isOwner || !detailsDirty()) return
    clearTimeout(detailsTimer.current)
    detailsTimer.current = setTimeout(() => { handleSave() }, 1000)
    return () => clearTimeout(detailsTimer.current)
  }, [title, fieldNotes, sketchLocation, visibility, glazed]) // eslint-disable-line react-hooks/exhaustive-deps

  function pickValueLevels(n) {
    setValueLevels(n)
    api.put(`/api/sketches/${sketchId}/studies`, { value_levels: n }).catch(() => {})
  }

  // The paints for the wheel: the kit's paints and the favourite palette,
  // else the starter list.
  useEffect(() => {
    if (tab !== 'color' || kitPaints || !sketch?.is_owner) return
    Promise.all([api.get('/api/kit').catch(() => ({ data: [] })), api.get('/api/profile').catch(() => ({ data: {} }))])
      .then(([kit, prof]) => setKitPaints(kitPaintList(kit.data, prof.data.favorite_paints || [])))
  }, [tab, kitPaints, sketch?.is_owner])

  // The mask saves itself a moment after a change ends.
  function saveMask(shapes, sw) {
    clearTimeout(maskSaveRef.current)
    maskSaveRef.current = setTimeout(() => {
      api.put(`/api/sketches/${sketchId}/studies`, { gamut_mask: { shapes, swatches: sw } }).catch(() => {})
    }, 400)
  }
  function changeMask(shapes, { done } = {}) {
    setMaskShapes(shapes)
    if (done) saveMask(shapes, swatches)
    else clearTimeout(maskSaveRef.current)
  }
  // A tile tapped on the wheel toggles: collected into "Your colours" and
  // shown, or, when already collected, taken out.
  function pickTile(sel) {
    if (swatches.some((s) => s.hex === sel.hex)) { dropSwatch(sel.hex); return }
    setColorSample(sel)
    const next = [...swatches, { h: sel.h, c: sel.c, hex: sel.hex }].slice(-16)
    setSwatches(next)
    saveMask(maskShapes, next)
  }
  function dropSwatch(hex) {
    const next = swatches.filter((s) => s.hex !== hex)
    setSwatches(next)
    if (colorSample?.hex === hex) setColorSample(null)
    saveMask(maskShapes, next)
  }
  const removeSwatch = () => dropSwatch(colorSample?.hex)
  // A swatch dragged onto the photo: its place (0 to 1, from the top left)
  // is kept for the critique.
  function placeSwatch(hex, { x, y }) {
    const next = swatches.map((s) => (s.hex === hex ? { ...s, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } : s))
    setSwatches(next)
    saveMask(maskShapes, next)
  }

  // ===== RENDER: LOADING / ERROR =====

  const modalTitle = mode === 'create' ? 'New Sketch Framework' : 'Edit Sketch Framework'

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
  const tabStudy = valueStudies[valueLevels]
  // Over the photo: the recipe strip at the bottom, the swatches above it.
  const swatchOverlay = (
    <>
      <RecipeStrip selected={colorSample} paints={mixPaints} onClose={() => setColorSample(null)} />
      <SwatchOverlay swatches={swatches} selected={colorSample} onSelect={setColorSample}
        onPlace={placeSwatch} onRemove={(hex) => dropSwatch(hex)} />
    </>
  )
  const studyPanels = tab === 'value'
    ? [
        { key: 'values', label: `${valueLevels} values`, content: tabStudy
          ? <StripImage src={tabStudy.valueStudyImage} alt={`The photo in ${valueLevels} values`} grid />
          : <div className="flex min-h-[40vh] flex-1 animate-pulse items-center justify-center text-md text-sc-text3">Reading the values…</div> },
        { key: 'photo', label: 'Reference photo', content: <StripImage src={referenceImageUrl} alt="Reference photo" grid /> },
      ]
    : tab === 'color'
      ? [
          { key: 'mask', label: 'In your mask', content: (
            <div className="flex min-h-0 flex-1 flex-col">
              <MaskedPhoto src={referenceImageUrl} shapes={maskShapes} overlay={swatchOverlay} />
            </div>
          ) },
          { key: 'sample', label: 'Photo', content: (
            <div className="flex min-h-0 flex-1 flex-col">
              <SamplePhoto src={referenceImageUrl} onSample={setColorSample} overlay={swatchOverlay} />
            </div>
          ) },
        ]
      : null
  const panels = studyPanels || [
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
  const stripKey = tab === 'value' || tab === 'color' ? tab : 'plan'
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
          // this sketch, so the sketcher can change the plan and read it again.
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
  // Create mode: Start Sketching, once the plan read is back. Uploads and
  // feedback live on the SketchDetail page (design doc, item 38).
  const startSketchingFooter = mode === 'create' && analysis?.plan_read ? (
    <div className="sc-footer">
      <Button variant="action" className="ml-auto" onClick={handleStartSketching} disabled={saving}>
        Start Sketching
      </Button>
    </div>
  ) : null
  const guideTab = (
    <>
      {guidePanel}
      {startSketchingFooter}
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
            className="sc-field min-h-[7rem] resize-y leading-normal"
          />
        </label>

        {/* Who sees the sketch once it's shared, and Glaze (design doc:
            protecting sketchers' work). */}
        <div className="flex flex-col gap-2">
          <span className="sc-field-label">Who can see it</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who can see this sketch">
            {VISIBILITY.map((v) => (
              <button key={v.key} type="button" role="radio" aria-checked={visibility === v.key} onClick={() => setVisibility(v.key)}
                className={`rounded-full border-[1.5px] px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  visibility === v.key ? 'border-sc-guide bg-sc-guide text-white' : 'border-sc-border text-white hover:border-sc-strong'
                }`}>
                {v.label}
              </button>
            ))}
          </div>
          <p className="m-0 text-sm text-sc-text3">{VISIBILITY.find((v) => v.key === visibility)?.note} Your plan and progress pages are only yours until you share the final sketch.</p>
        </div>
        <label className="flex items-start gap-2.5 text-sm text-white">
          <input type="checkbox" checked={glazed} onChange={(e) => setGlazed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-sc-guide" />
          <span>
            My final sketch is Glazed. <a href={GLAZE_URL} target="_blank" rel="noreferrer" className="underline">What is Glaze?</a>
            <span className="block text-sc-text3">Glaze, a free tool from the University of Chicago, changes your image so AI has a harder time copying your style. Glaze it before you upload.</span>
          </span>
        </label>

        {saveError && <p className="text-base text-accent">{saveError}</p>}
        {deleteError && <p className="text-base text-accent">{deleteError}</p>}
        
      </div>
      <div className="sc-footer">
        {/* Details save as you type, like the other tabs. */}
        <span className={`text-base text-sc-text3 ${saving ? 'animate-pulse' : ''}`}>
          {saving ? 'Saving…' : savedJustNow ? 'Saved' : 'Changes save as you type.'}
        </span>
      </div>
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
        open={confirmingDelete}
        title="Delete this sketch?"
        message="This removes its photo and any feedback, and can't be undone."
        confirmLabel="Delete sketch"
        cancelLabel="Keep it"
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />

      {/* ===== LEFT: PHOTO STAGE (sideways strip) ===== */}
      <StageStrip key={stripKey} ref={stripRef} panels={panels} focusKey={studyPanels ? panels[0].key : 'plan'} />

      {/* ===== RIGHT: TABS ===== */}
      <div ref={sheet.ref} className={`sc-panel sc-sheet ${sheet.className}`} style={sheet.style}>
        <button
          type="button"
          className="sc-sheet-handle touch-none"
          {...sheet.handleProps}
          aria-label={sheetOpen ? 'Fold the panel down' : 'Open the panel'}
          aria-expanded={sheetOpen}
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
              {tab === 'value' && (
                <>
                  <div className="sc-panel-body">
                    <ValuePanel levels={valueLevels} onLevels={pickValueLevels} study={tabStudy} loading={!tabStudy} error={valueError} />
                  </div>
                  {startSketchingFooter}
                </>
              )}
              {tab === 'color' && (
                <>
                  <div className="sc-panel-body">
                    {kitPaints ? (
                      <ColorPanel shapes={maskShapes} onChange={changeMask} paints={mixPaints}
                        fromKit={kitPaints.length > 0} selected={colorSample} onSelect={setColorSample}
                        onPickTile={pickTile} marked={swatches} onRemoveSwatch={removeSwatch}
                        isSwatch={colorSample?.from === 'wheel' && swatches.some((s) => s.hex === colorSample.hex)}
                        readOnly={Boolean(sketch.final_sketch_url)} />
                    ) : <p className="animate-pulse text-md text-sc-text3">Loading your paints…</p>}
                  </div>
                  {startSketchingFooter}
                </>
              )}
            </div>
          </>
        ) : (
          <div className={`flex min-h-0 flex-1 flex-col ${sheetOpen ? '' : 'max-md:hidden'}`}>{viewerPanel}</div>
        )}
      </div>
    </SketchModal>
  )
}
