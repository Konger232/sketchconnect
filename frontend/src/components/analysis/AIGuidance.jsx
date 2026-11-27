import { useEffect, useRef, useState } from 'react'
import PlanReadCard, { bookmarkKey } from './PlanReadCard'
import { api } from '../../lib/api'

/**
 * Capture's Tips (design doc, items 25 and 57): the plan read card, and
 * what the sketcher does with it, saved as they go:
 *   - "Is this right?": one rating of the whole read (key "plan_read").
 *   - Bookmarked tips (key "bookmark"), one per principle and tip name.
 *   - The focal areas to consider: tapping one shows it in red on the
 *     photo (onSuggestionChange); its bookmark, or a tap on the red area
 *     (suggestionTap, a count), adds it to the plan as a stroke along its
 *     outline, and onMarksChange(marks) passes the saved list up.
 * The tips' strokes are highlighted through onHighlight(ids).
 *
 * The guided questions and Help Quest that New Sketch and Edit Sketch
 * showed here went with those pages (November 27, 2026).
 */
export default function AIGuidance({
  sketchId,
  // The sketch's saved answers (session_choices): the rating and bookmarks.
  savedChoices = [],
  // The plan read: { principles, relationships }.
  planRead = null,
  // The focal areas to consider ([{ region_ref, label, reason, adopted }]).
  focalSuggestions = [],
  // The final sketch is in: bookmarks and areas are locked.
  bookmarksLocked = false,
  onHighlight,
  onSuggestionChange,
  onMarksChange,
  suggestionTap = 0,
}) {
  const [choices, setChoices] = useState(savedChoices)
  // The focal area drawn in red on the photo, and the areas added since.
  const [shownArea, setShownArea] = useState(null)
  const [adoptedNow, setAdoptedNow] = useState({})
  const areas = (focalSuggestions || []).map((sg) => ({
    ...sg, adopted: adoptedNow[sg.region_ref] ?? Boolean(sg.adopted),
  }))
  useEffect(() => () => onSuggestionChange?.(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  function save(entry, what) {
    api.post(`/api/sketches/${sketchId}/session-choices`, entry)
      .catch((err) => console.warn(`Could not save the ${what}`, err))
  }

  // The rating: the same thumb again clears it.
  const vote = choices.find((c) => c.key === 'plan_read' && c.vote && !c.principle)?.vote || null
  function handleVote(next) {
    const entry = { key: 'plan_read', prompt: 'Is this right?', response: next || '', vote: next || undefined }
    setChoices((cur) => [...cur.filter((c) => c.key !== 'plan_read'), ...(next ? [entry] : [])])
    save(entry, 'thumb')
  }

  const bookmarks = new Set(choices.filter((c) => c.key === 'bookmark' && c.bookmarked).map((c) => bookmarkKey(c.principle, c.response)))
  function handleBookmark(principle, tip, on) {
    const entry = { key: 'bookmark', prompt: tip.tip, response: tip.name, principle, bookmarked: on, mark_ids: tip.ids || [] }
    setChoices((cur) => [
      ...cur.filter((c) => !(c.key === 'bookmark' && c.principle === principle && c.response === tip.name)),
      ...(on ? [entry] : []),
    ])
    save(entry, 'bookmark')
  }

  function showArea(sg) {
    setShownArea(sg)
    onSuggestionChange?.(sg)
  }
  // Add the area to the plan as a stroke along its outline (prompted), or
  // take it off. The red area turns into the stroke.
  function adoptArea(sg, on) {
    setAdoptedNow((cur) => ({ ...cur, [sg.region_ref]: on }))
    const undo = () => setAdoptedNow((cur) => ({ ...cur, [sg.region_ref]: !on }))
    const call = on
      ? api.post(`/api/sketches/${sketchId}/marks/adopt`, {
        region_ref: sg.region_ref,
        color: getComputedStyle(document.documentElement).getPropertyValue('--mark-color').trim() || '#fde68a',
        size_mm: 1,
      })
      : api.delete(`/api/sketches/${sketchId}/marks/adopt/${sg.region_ref}`)
    call.then(({ data }) => onMarksChange?.(data.marks))
      .catch((err) => { console.warn('Could not change the area on the plan', err); undo() })
  }

  // A tap on the red area: the same as its bookmark. Only taps made while
  // this panel is open count.
  const seenTap = useRef(suggestionTap)
  useEffect(() => {
    if (suggestionTap === seenTap.current) return
    seenTap.current = suggestionTap
    const sg = shownArea && areas.find((a) => a.region_ref === shownArea.region_ref)
    if (sg && !sg.adopted && !bookmarksLocked) adoptArea(sg, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionTap])

  return (
    <div className="sc-guide animate-fade-in-up">
      <PlanReadCard planRead={planRead} onHighlight={onHighlight} vote={vote} onVote={handleVote}
        bookmarks={bookmarks} onBookmark={bookmarksLocked ? undefined : handleBookmark}
        suggestions={areas} onShowSuggestion={showArea}
        onAdopt={bookmarksLocked ? undefined : adoptArea} />
    </div>
  )
}
