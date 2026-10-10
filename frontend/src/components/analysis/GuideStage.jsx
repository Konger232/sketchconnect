import { useEffect, useState } from 'react'
import Fade from './Fade'
import { Reticle } from './Reticle'
import { MarksLayer } from './Marks'
import PerspectiveLinesOverlay, { hasPerspective } from './PerspectiveLinesOverlay'
import ShapeOutlineOverlay from './ShapeOutlineOverlay'
import ProportionOverlay from './ProportionOverlay'
import SquareGridOverlay from './SquareGridOverlay'
import RuleOfThirdsGrid from './RuleOfThirdsGrid'
import AISuggestedReticle from './AISuggestedReticle'
import { usePaintedRect } from '../../lib/usePaintedRect'

/**
 * The Sparks tab's photo stage: the framed photo on black, with the marks,
 * the rule-of-thirds grid and any overlay an answer turned on.
 *
 * There is no rail (October 6, 2026). The old Guides rail toggled marks,
 * Select marks, Mark a spot, rule of thirds, grid, perspective,
 * proportions and values. Now marks and rule of thirds always show, and
 * the other overlays turn on only from an answer's option (applyAction).
 * Marks are drawn and erased in New Sketch's Marks step only.
 */

// The overlays an answer can turn on. question_bank.json action names that
// differ from the tool names here are mapped by ACTION_TOOL.
const OVERLAYS = ['grid', 'perspective', 'proportions', 'values']
const ACTION_TOOL = { value_study: 'values' }

/**
 * Overlay state for GuideStage, owned by the page.
 *   applyAction(name)  an answer's overlay (prepared_prompts option_actions)
 *   clearOverlays()    turns every answer overlay off again
 * Marks and rule of thirds stay on.
 */
export function useGuides() {
  const [on, setOn] = useState({ rule_of_thirds: true, marks: true })

  function setTool(tool, value) {
    setOn((prev) => ({ ...prev, [tool]: value }))
  }

  function applyAction(action) {
    const tool = ACTION_TOOL[action] || action
    if (!OVERLAYS.includes(tool)) {
      console.warn('Unknown guidance action', action)
      return
    }
    setTool(tool, true)
  }

  function clearOverlays() {
    setOn((prev) => {
      if (!OVERLAYS.some((t) => prev[t])) return prev
      const next = { ...prev }
      for (const t of OVERLAYS) next[t] = false
      return next
    })
  }

  return { on, setTool, applyAction, clearOverlays }
}

export default function GuideStage({
  imageUrl,
  alt = 'Reference photo',
  guides,
  marks = [],
  perspective,
  focalRegions = [],
  proportions,
  valueStudy,
  aiSuggestion,
  // Marks the current guided question is about. They show, and the rest
  // fade, even when the Marks toggle is off.
  highlightMarkIds = [],
  // "Have you considered capturing ...?" (New Sketch only): a tap on the red
  // area answers "Yes, add it". On a "Do you see ...?" question, a tap on
  // the AI's reticle answers "I see it now". Once added (suggestionAdded), the red area
  // fades and the new stroke along its outline takes its place.
  onSuggestionTap,
  suggestionAdded = false,
  // The sketcher's spot, { x, y, mark_ids }, drawn as their own reticle.
  spot = null,
  // Answer by lines (owner only, while a question's options are tied to
  // marks, or the question takes a tap as its answer): called with a 0-1000
  // frame point and the frame's aspect when the sketcher taps the photo.
  onPickAt,
  // Parts of the scene picked by a tap while answering ([{ id, points }]),
  // drawn dashed (ShapeOutlineOverlay variant "answer").
  answerOutlines = [],
}) {
  const [imgRef, rect] = usePaintedRect()
  const { on } = guides

  // What this photo has data for. An overlay without data stays hidden.
  const available = {
    marks: marks.length > 0,
    perspective: hasPerspective(perspective),
    rule_of_thirds: true,
    grid: true,
    proportions: !!proportions?.unit,
    values: !!valueStudy,
  }

  // Values: fetched the first time they're turned on (useValueStudy).
  useEffect(() => {
    if (on.values && valueStudy && !valueStudy.image && !valueStudy.loading) valueStudy.show()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on.values])
  useEffect(() => {
    if (valueStudy?.error) guides.setTool('values', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueStudy?.error])

  const show = (tool) => !!on[tool] && available[tool]

  // "Have you considered capturing the ...?" points at one focal area
  // (aiSuggestion.region_ref, an index into focalRegions). Only that area's
  // outline shows. The last one is kept while it fades out.
  const suggestedRegion = Number.isInteger(aiSuggestion?.region_ref) ? focalRegions[aiSuggestion.region_ref] || null : null
  const [shownRegion, setShownRegion] = useState(suggestedRegion)
  useEffect(() => {
    if (suggestedRegion) setShownRegion(suggestedRegion)
  }, [suggestedRegion])
  // The photo takes taps only for answering a guided question.
  const tappable = !!onPickAt

  return (
    // Phone: the photo spans the full width at its own height (at most
    // 75vh), so nothing is wasted above or below it. From 768px it fills
    // the stage's width, inset top and bottom only.
    <div className="relative flex-1 overflow-hidden bg-sc-modal md:min-h-0">
      <div className="relative md:absolute md:inset-x-0 md:inset-y-[var(--stage-inset)]">
        <img ref={imgRef} src={imageUrl} alt={alt} className="block h-auto max-h-[75vh] w-full animate-fade-in-scale object-contain md:h-full md:max-h-none" />

        {rect && (
          <div className="pointer-events-none absolute" style={rect}>
            {/* Every guide fades in and out when toggled (Fade). */}
            <Fade as="div" show={show('values') && !!valueStudy?.image}>
              {valueStudy?.image && <img src={valueStudy.image} alt="" className="absolute inset-0 h-full w-full" />}
            </Fade>
            <Fade as="div" show={show('rule_of_thirds')}>
              <RuleOfThirdsGrid />
            </Fade>
            {/* Parts of the scene picked by a tap as the answer. */}
            <Fade as="div" show={answerOutlines.length > 0}>
              {answerOutlines.length > 0 && <ShapeOutlineOverlay focalRegions={answerOutlines} variant="answer" />}
            </Fade>
            {/* The one focal area the current question asks about. */}
            <Fade as="div" show={!!suggestedRegion && !suggestionAdded}>
              {shownRegion && (
                <ShapeOutlineOverlay
                  focalRegions={[shownRegion]}
                  onRegionClick={suggestedRegion && !suggestionAdded ? onSuggestionTap : undefined}
                  regionLabel={aiSuggestion?.label}
                />
              )}
            </Fade>
            <Fade as="div" show={show('perspective')}>
              <PerspectiveLinesOverlay perspective={perspective} />
            </Fade>
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              overflow="visible"
              // Answering by a tap: this layer takes taps (its parent ignores them).
              className={`absolute inset-0 h-full w-full ${tappable ? 'pointer-events-auto cursor-pointer' : ''}`}
              onClick={tappable ? (e) => {
                const r = e.currentTarget.getBoundingClientRect()
                if (!r.width || !r.height) return
                const p = [((e.clientX - r.left) / r.width) * 1000, ((e.clientY - r.top) / r.height) * 1000]
                // The overlay covers the framed photo, so its shape is the frame's.
                const aspect = r.width / r.height
                onPickAt(p, aspect)
              } : undefined}
            >
              <Fade show={show('grid')}>
                <SquareGridOverlay />
              </Fade>
              <Fade show={show('proportions')}>
                <ProportionOverlay proportions={proportions} />
              </Fade>
              <Fade show={show('marks') || highlightMarkIds.length > 0}>
                <MarksLayer
                  marks={show('marks') ? marks : marks.filter((m) => highlightMarkIds.includes(m.id))}
                  highlight={highlightMarkIds}
                />
              </Fade>
              {/* The sketcher's spot on their lines, while a question shows. */}
              {spot && <Reticle x={spot.x} y={spot.y} />}
              {/* The AI's suggested spot (a dot), while its question is
                  showing. A suggested area shows only its red outline, no
                  reticle. Has its own fade (AISuggestedReticle). */}
              <AISuggestedReticle suggestion={suggestedRegion ? null : aiSuggestion} onTap={onSuggestionTap} />
            </svg>
          </div>
        )}
      </div>

      {valueStudy?.error && (
        <p className="absolute left-4 top-4 rounded-lg bg-sc-rail px-3 py-2 text-base text-white">{valueStudy.error}</p>
      )}
    </div>
  )
}
