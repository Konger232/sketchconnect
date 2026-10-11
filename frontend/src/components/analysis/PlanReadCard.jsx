import { useState } from 'react'
import Icon from '../common/Icon'
import Button, { BookmarkButton } from '../common/Button'

/**
 * "Your plan" (design doc, Section 11, item 25): the plan read, the guide
 * giving back, as one scroll with nothing to answer.
 *   1. The principles the strokes carry (strong, moderate), each in its own
 *      bordered group with its tips; a relationship's tips are listed under
 *      the principle it belongs to, with no type label. The top 2 show;
 *      "See more" shows the rest, then one line per principle the plan does
 *      not carry yet. With none carried, the card is "Ideas for this scene".
 *   2. "You might want to consider adding these to your sketch": the focal
 *      areas no stroke of the sketcher's marks. Tapping one shows it in red
 *      on the photo; its bookmark adds it to the plan (the red area turns
 *      into a stroke).
 *   3. "Is this right?": one rating of the whole read.
 *
 * Every row (tip, idea, focal area) is the guide's choice button (Button
 * variant "choice", the same as New Sketch's and Edit Sketch's answers),
 * with a BookmarkButton inside on the right. active: its strokes or area
 * are on the photo. selected: bookmarked or added (blue).
 *
 *   planRead   { principles, relationships } in card order (plan_read.clean)
 *   onHighlight(ids)  the strokes to highlight on the photo, or []
 *   vote, onVote(vote | null)  "Is this right?"; the same thumb clears it
 *   bookmarks  Set of 'principle:tip name' keys
 *   onBookmark(principle, tip, on)  without it, bookmarks are locked
 *   suggestions  [{ region_ref, label, reason, adopted }] (focal_list)
 *   onShowSuggestion(sg | null)  the area to draw in red, or none
 *   onAdopt(sg, on)  add the area to the plan, or take it off; without it,
 *              locked (the final sketch is uploaded)
 */
const MAX_BULLETS = 3
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1)
export const bookmarkKey = (principle, name) => `${principle}:${name}`

function Thumbs({ vote, onVote }) {
  if (!onVote) return null
  const thumb = (v, name, text) => (
    <button
      type="button"
      aria-label={text}
      aria-pressed={vote === v}
      onClick={() => onVote(vote === v ? null : v)}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        vote === v ? 'bg-sc-guide text-white' : 'text-sc-text3 hover:text-white'
      }`}
    >
      <Icon name={name} size={15} />
    </button>
  )
  return (
    <div className="flex items-center justify-end gap-1">
      <span className="mr-1 text-sm text-sc-text3">Is this right?</span>
      {thumb('up', 'thumb-up', 'Yes, this reads my plan right')}
      {thumb('down', 'thumb-down', 'No, this misreads my plan')}
    </div>
  )
}

export default function PlanReadCard({
  planRead, onHighlight, vote = null, onVote, bookmarks = new Set(), onBookmark,
  suggestions = [], onShowSuggestion, onAdopt,
}) {
  const [more, setMore] = useState(false)
  // What is on the photo: a principle ('p:movement'), a tip ('b:movement:1')
  // or a focal area ('s:0').
  const [lit, setLit] = useState(null)

  const principles = planRead?.principles || []
  const carried = principles.filter((p) => p.group !== 'none')
  const ideas = principles.filter((p) => p.group === 'none' && p.tips?.length)
  const relsOf = (name) => (planRead?.relationships || []).filter((r) => r.principle === name)

  function light(key, ids) {
    const next = lit === key || !ids?.length ? null : key
    if (lit?.startsWith('s:')) onShowSuggestion?.(null)
    setLit(next)
    onHighlight?.(next ? ids : [])
  }

  function showArea(sg, keep = false) {
    const key = `s:${sg.region_ref}`
    const next = lit === key && !keep ? null : key
    setLit(next)
    onHighlight?.([])
    onShowSuggestion?.(next ? sg : null)
  }

  // One row: the choice button, with its bookmark inside on the right.
  function row({ key, title, text, onClick, selected, toggle, label }) {
    return (
      <Button
        key={key}
        variant="choice"
        active={lit === key}
        selected={selected}
        aria-pressed={lit === key}
        onClick={onClick}
        trailing={<BookmarkButton on={selected} onToggle={toggle} label={label} />}
      >
        <span className="block font-normal leading-snug">
          <span className="font-bold">{title}</span>
          {text && <>: {text}</>}
        </span>
      </Button>
    )
  }

  const tipRow = (p, t, key) => {
    const on = bookmarks.has(bookmarkKey(p.principle, t.name))
    return row({
      key, title: t.name, text: t.tip, selected: on,
      onClick: () => light(key, t.ids),
      toggle: onBookmark ? () => onBookmark(p.principle, t, !on) : undefined,
      label: on ? `Remove bookmark: ${t.name}` : `Bookmark: ${t.name}`,
    })
  }

  // A principle the plan does not carry yet: its one tip, to keep for later.
  // No strokes, so nothing to highlight.
  const ideaRow = (p) => {
    const t = { ...p.tips[0], ids: [] }
    const on = bookmarks.has(bookmarkKey(p.principle, t.name))
    return row({
      key: `i:${p.principle}`, title: cap(p.principle), text: t.tip, selected: on,
      toggle: onBookmark ? () => onBookmark(p.principle, t, !on) : undefined,
      label: on ? `Remove bookmark: ${t.name}` : `Bookmark: ${t.name}`,
    })
  }

  const areaRow = (sg) => row({
    key: `s:${sg.region_ref}`, title: cap(sg.label), text: sg.reason, selected: sg.adopted,
    onClick: () => showArea(sg),
    toggle: onAdopt ? () => { onAdopt(sg, !sg.adopted); showArea(sg, true) } : undefined,
    label: sg.adopted ? `Take ${sg.label} off the plan` : `Add ${sg.label} to the plan`,
  })

  function tipsOf(p) {
    return [
      ...(p.tips || []).map((t) => ({ ...t, ids: p.mark_ids })),
      ...relsOf(p.principle).flatMap((r) => (r.tips || []).map((t) => ({ ...t, ids: r.mark_ids }))),
    ].slice(0, MAX_BULLETS)
  }

  const block = (p) => (
    <section key={p.principle} className="flex flex-col gap-2 rounded-xl border border-gray-700 p-3">
      <button
        type="button"
        onClick={() => light(`p:${p.principle}`, p.mark_ids)}
        aria-pressed={lit === `p:${p.principle}`}
        className={`self-start text-left font-heading text-lg font-bold transition-colors ${
          lit === `p:${p.principle}` ? 'text-sc-guide' : 'text-white hover:text-sc-guide'
        }`}
      >
        {cap(p.principle)}
      </button>
      <div className="sc-options">
        {tipsOf(p).map((t, i) => tipRow(p, t, `b:${p.principle}:${i}`))}
      </div>
    </section>
  )

  if (!principles.length) {
    return <p className="sc-body">No plan read for this sketch.</p>
  }

  const top = carried.slice(0, 2)
  const rest = carried.slice(2)
  const hasMore = carried.length ? rest.length > 0 || ideas.length > 0 : ideas.length > 2

  return (
    <div className="flex flex-col gap-3">
      <p className="font-heading text-question font-bold text-white">
        {carried.length ? 'Your plan' : 'Ideas for this scene'}
      </p>
      {carried.length ? top.map(block) : <div className="sc-options">{ideas.slice(0, 2).map(ideaRow)}</div>}
      {hasMore && (
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className="flex items-center gap-1 self-start text-base font-semibold text-sc-text3 hover:text-white"
        >
          {more ? 'See less' : 'See more'}
          <Icon name={more ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
      )}
      {more && (
        <div className="flex animate-fade-in-up flex-col gap-3">
          {rest.map(block)}
          {ideas.length > (carried.length ? 0 : 2) && (
            <div className="sc-options">{(carried.length ? ideas : ideas.slice(2)).map(ideaRow)}</div>
          )}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-2 pt-2">
          <p className="font-heading text-lg font-bold text-white">You might want to consider adding these to your sketch</p>
          <div className="sc-options">{suggestions.map(areaRow)}</div>
        </div>
      )}
      <Thumbs vote={vote} onVote={onVote} />
    </div>
  )
}
