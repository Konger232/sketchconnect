import { useEffect, useState } from 'react'
import Icon from '../common/Icon'
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
 * The Guide tab's photo stage (design handoff, "floating rail"): the
 * framed photo on black, every guide drawn over it, and the rail that
 * turns guides on and off.
 *
 *   collapsed   one "Guides" button, bottom right. Only marks show.
 *   open        a vertical rail of groups (Plan, Space, Shape, Value) and
 *               a close button. Picking a group slides its tools out to
 *               the left, level with that button, stacked vertically.
 *               One group open at a time. A badge on each group shows
 *               how many of its tools are on.
 *
 * A group with nothing to show for this photo is hidden, and so is a tool
 * with no data (no perspective came back, no marks were drawn, ...).
 *
 * Which guides are on lives in useGuides() (below), owned by the page, so
 * a guide question's answer can open a group and turn its tool on.
 */

export const GUIDE_GROUPS = [
  // Focal points are retired (design doc, item 17): marks are the plan, and
  // a spot on the lines replaces the focal point.
  { key: 'plan', label: 'Plan', icon: 'guide-plan', tools: [['marks', 'Marks'], ['select_marks', 'Select marks'], ['mark_spot', 'Mark a spot']] },
  { key: 'space', label: 'Space', icon: 'guide-space', tools: [['perspective', 'Perspective'], ['rule_of_thirds', 'Rule of thirds'], ['grid', 'Grid']] },
  // Focal areas are not a guide (design doc, item 20): they are kept for
  // comparing with the marks. One shows only while its question asks about it.
  { key: 'shape', label: 'Shape', icon: 'guide-shape', tools: [['proportions', 'Proportions']] },
  { key: 'value', label: 'Value', icon: 'guide-value', tools: [['values', 'Values']] },
]

// question_bank.json action names that differ from the tool names here.
const ACTION_TOOL = { value_study: 'values' }

function groupOf(tool) {
  return GUIDE_GROUPS.find((g) => g.tools.some(([t]) => t === tool))?.key || null
}

/**
 * Guide state for GuideStage. Starts with only rule of thirds on 
 * and the rail collapsed.
 *   applyAction(name)  an answer's overlay (prepared_prompts option_actions):
 *                      opens the rail at that tool's group and turns it on
 * The two grids crowd each other, so turning one on turns the other off.
 */
export function useGuides() {
  // set which tools auto display on the plan image
  const [on, setOn] = useState({ rule_of_thirds: true, marks: true })
  const [railOpen, setRailOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState(null)

  const EXCLUSIVE = {
    grid: 'rule_of_thirds', rule_of_thirds: 'grid',
    // Both take taps on the photo, so only one at a time.
    select_marks: 'mark_spot', mark_spot: 'select_marks',
  }

  function setTool(tool, value) {
    setOn((prev) => {
      const next = { ...prev, [tool]: value }
      if (value && EXCLUSIVE[tool]) next[EXCLUSIVE[tool]] = false
      // Selecting and marking a spot need the marks on screen.
      if ((tool === 'select_marks' || tool === 'mark_spot') && value) next.marks = true
      if (tool === 'marks' && !value) {
        next.select_marks = false
        next.mark_spot = false
      }
      return next
    })
  }

  function applyAction(action) {
    const tool = ACTION_TOOL[action] || action
    const group = groupOf(tool)
    if (!group) {
      console.warn('Unknown guidance action', action)
      return
    }
    //setRailOpen(true)
    //setOpenGroup(group)
    setTool(tool, true)
  }

  return {
    on,
    railOpen,
    openGroup,
    setTool,
    toggle: (tool) => setTool(tool, !on[tool]),
    applyAction,
    openRail: () => setRailOpen(true),
    closeRail: () => { setRailOpen(false); setOpenGroup(null) },
    pickGroup: (key) => setOpenGroup((cur) => (cur === key ? null : key)),
  }
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
  showRail = true,
  // Owner only: called with a 0-1000 frame point and the frame's aspect
  // (width / height) when the sketcher taps
  // the photo while Select marks is on. The page finds the mark and saves.
  onSelectAt,
  // Marks the current guided question is about. They show, and the rest
  // fade, even when the Marks toggle is off.
  highlightMarkIds = [],
  // Mark a spot (owner only, while a guided question shows): called with a
  // 0-1000 frame point when the sketcher taps the photo. The page snaps it
  // to where their lines meet (lib/markGeometry.js snapSpot).
  onSpotAt,
  // The sketcher's spot, { x, y, mark_ids }, drawn as their own reticle.
  spot = null,
  // Answer by lines (owner only, while a question's options are tied to
  // marks, or the question takes a tap as its answer): called with a 0-1000
  // frame point and the frame's aspect when the sketcher taps the photo
  // and neither tap tool above is on.
  onPickAt,
  // Parts of the scene picked by a tap while answering ([{ id, points }]),
  // drawn dashed (ShapeOutlineOverlay variant "answer").
  answerOutlines = [],
}) {
  const [imgRef, rect] = usePaintedRect()
  const { on } = guides

  // What this photo has data for. A tool without data is hidden.
  const available = {
    marks: marks.length > 0,
    select_marks: marks.length > 0 && !!onSelectAt,
    mark_spot: marks.length > 0 && !!onSpotAt,
    perspective: hasPerspective(perspective),
    rule_of_thirds: true,
    grid: true,
    proportions: !!proportions?.unit,
    values: !!valueStudy,
  }
  const groups = GUIDE_GROUPS
    .map((g) => ({ ...g, tools: g.tools.filter(([t]) => available[t]) }))
    .filter((g) => g.tools.length > 0)

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
  // The photo takes taps for Select marks, Mark a spot, or answering by lines.
  const tappable = show('select_marks') || show('mark_spot') || !!onPickAt

  return (
    <div className="relative min-h-[55vh] flex-1 overflow-hidden bg-sc-modal md:min-h-0">
      <div className="absolute inset-3 md:inset-[var(--stage-inset)]">
        <img ref={imgRef} src={imageUrl} alt={alt} className="h-full w-full animate-fade-in-scale object-contain" />

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
            <Fade as="div" show={!!suggestedRegion}>
              {shownRegion && <ShapeOutlineOverlay focalRegions={[shownRegion]} />}
            </Fade>
            <Fade as="div" show={show('perspective')}>
              <PerspectiveLinesOverlay perspective={perspective} />
            </Fade>
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              overflow="visible"
              // Select marks: this layer takes taps (its parent ignores them).
              className={`absolute inset-0 h-full w-full ${tappable ? 'pointer-events-auto cursor-pointer' : ''}`}
              onClick={tappable ? (e) => {
                const r = e.currentTarget.getBoundingClientRect()
                if (!r.width || !r.height) return
                const p = [((e.clientX - r.left) / r.width) * 1000, ((e.clientY - r.top) / r.height) * 1000]
                // The overlay covers the framed photo, so its shape is the frame's.
                const aspect = r.width / r.height
                if (show('select_marks')) onSelectAt(p, aspect)
                else if (show('mark_spot')) onSpotAt(p, aspect)
                else onPickAt(p, aspect)
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
              {/* The AI's suggestion, while its question is showing. Has
                  its own fade (AISuggestedReticle). */}
              <AISuggestedReticle suggestion={aiSuggestion} />
            </svg>
          </div>
        )}
      </div>

      {showRail && groups.length > 0 && (
        <div className="absolute bottom-4 right-4">
          {!guides.railOpen ? (
            <button type="button" className="rail-toggle" aria-expanded="false" onClick={guides.openRail}>
              <Icon name="layers" size={22} />
              Guides
            </button>
          ) : (
            <div className="rail flex-col" role="toolbar" aria-label="Guides" aria-orientation="vertical">
              {groups.map((g) => {
                const open = guides.openGroup === g.key
                // How many of this group's tools are on right now.
                const count = g.tools.filter(([t]) => on[t]).length
                return (
                  <div key={g.key} className="relative">
                    <button
                      type="button"
                      className="rail-group"
                      aria-pressed={open}
                      aria-expanded={open}
                      onClick={() => guides.pickGroup(g.key)}
                    >
                      <Icon name={g.icon} size={18} />
                      {g.label}
                      {count > 0 && (
                        <span className="rail-count" aria-label={`${count} on`}>{count}</span>
                      )}
                    </button>
                    {/* The group's tools, stacked, level with its button. */}
                    {open && (
                      <div className="rail absolute right-full top-1/2 mr-3.5 -translate-y-1/2 flex-col animate-fade-in-scale" role="group" aria-label={g.label}>
                        {g.tools.map(([tool, label]) => (
                          <button
                            key={tool}
                            type="button"
                            className="rail-tool"
                            aria-pressed={!!on[tool]}
                            disabled={tool === 'values' && valueStudy?.loading}
                            onClick={() => guides.toggle(tool)}
                          >
                            {tool === 'values' && valueStudy?.loading ? 'Loading…' : label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              <button
                type="button"
                aria-label="Close guides"
                className="flex h-11 w-[var(--rail-button)] items-center justify-center rounded-xl text-sc-muted hover:text-white"
                onClick={guides.closeRail}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {valueStudy?.error && (
        <p className="absolute left-4 top-4 rounded-lg bg-sc-rail px-3 py-2 text-base text-white">{valueStudy.error}</p>
      )}
    </div>
  )
}
