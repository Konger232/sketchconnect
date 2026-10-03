import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../common/Icon'
import Button, { NextButton } from '../common/Button'
import { api } from '../../lib/api'

// Asked once per selected shape or missed area, so the question text tells
// them apart. Matched with _repeated_keys in backend sketches/router.py.
// Marks analysis questions about one shape (shape_id) or gated on a
// principle (requires_principle) repeat the same way.
const REPEATED_KEYS = ['mark_meaning', 'focal_suggestion', 'principle_intent', 'unseen']

function isRepeated(prompt) {
  return REPEATED_KEYS.includes(prompt.key) || Boolean(prompt.shape_id || prompt.requires_principle)
}

// Marks analysis questions about objects ({A}, {B}) are told apart by the
// objects (shape ids), since their wording changes with the sketcher's names.
function refsOf(prompt) {
  if (prompt?.after_relationship?.length) return prompt.after_relationship
  return Object.values(prompt?.name_refs || {})
}

function sameRefs(a = [], b = []) {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')
}

// Matched with same_question in backend sketches/router.py.
function sameQuestion(choice, prompt) {
  if (!choice || !prompt || choice.key !== prompt.key) return false
  if (prompt.key === 'mark_meaning' && prompt.shape_id) return choice.shape_id === prompt.shape_id
  const refs = refsOf(prompt)
  if (refs.length) return sameRefs(choice.refs, refs)
  return !isRepeated(prompt) || choice.prompt === prompt.question
}

// The relationship answer a principle question follows, or undefined.
function relationshipFor(prompt, choices) {
  return choices.find((c) => c.key === 'relationship' && sameRefs(c.refs, prompt.after_relationship))
}

// The question as the sketcher sees it (Elements x Principles Matrix doc,
// "Guide sequence"): {A} and {B} filled with the sketcher's own names from
// "What do you see it as?", and for "What do you want to bring out?" the
// variant for the relationship they picked ("other" for a tap or their
// own words).
function resolvePrompt(prompt, choices) {
  if (!prompt) return null
  const names = {}
  for (const [k, sid] of Object.entries(prompt.name_refs || {})) {
    const c = choices.find((x) => x.key === 'mark_meaning' && x.shape_id === sid)
    names[k] = c?.name || prompt.default_names?.[k] || ''
  }
  const fill = (t) => (t || '').replace(/\{([AB])\}/g, (_, k) => names[k] || '').replace(/^\s*(\w)/, (m) => m.toUpperCase())
  let p = prompt
  if (prompt.variants && Object.keys(prompt.variants).length) {
    const rel = relationshipFor(prompt, choices)
    const type = rel?.relationship?.type
    const v = prompt.variants[type] || prompt.variants.other
    if (!v) return null
    p = { ...prompt, ...v, relationship_type: prompt.variants[type] ? type : 'other' }
  }
  if (!Object.keys(names).length) return p
  return { ...p, question: fill(p.question), options: (p.options || []).map(fill), names }
}

// Not overlays: "describe" opens a text field, "mark" (answer by selecting a
// mark, design doc item 21) is not built yet, so it only saves the answer.
const NOT_OVERLAYS = ['describe', 'mark']

// The principles the sketcher works toward (design doc, item 20), from the
// saved answers: principle_intent picks, and a Yes to the relationship.
// Mirrors intents_from_choices in backend marks_analysis/service.py.
function intentsFrom(choices) {
  const out = []
  for (const c of choices) {
    if (c.key === 'principle_intent' && !c.undecided_principle) {
      for (const p of c.principles || []) out.push({ principle: p, mark_ids: c.mark_ids || [] })
    }
    // Answers saved before October 3, 2026: a Yes to the old yes/no
    // relationship question. The new relationship step names a connection;
    // its principle step records the intent.
    if (c.key === 'relationship' && c.response === 'Yes' && c.relationship?.principle) {
      out.push({ principle: c.relationship.principle, mark_ids: c.mark_ids || [] })
    }
  }
  return out
}

// A seed question (requires_principle) is asked only when the sketcher
// chose its principle for at least one of its marks.
function isAsked(prompt, choices) {
  // "What do you want to bring out?" follows its relationship question.
  if (prompt?.after_relationship?.length) return Boolean(relationshipFor(prompt, choices))
  if (!prompt?.requires_principle) return true
  const marks = new Set(prompt.mark_ids || [])
  return intentsFrom(choices).some(
    (i) => i.principle === prompt.requires_principle && i.mark_ids.some((id) => marks.has(id)),
  )
}

// A changed answer can drop a principle. The answers to seed questions
// that principle opened no longer apply, so they are dropped too. Mirrors
// the server (sketches/router.py, add_session_choice).
function withoutStaleSeeds(choices) {
  return choices.filter((c) => {
    if (c.requires_principle) return isAsked(c, choices)
    // A principle answer that followed a relationship type the sketcher
    // has since changed no longer applies.
    if (c.key === 'principle_intent' && c.refs?.length && c.relationship_type) {
      const rel = choices.find((x) => x.key === 'relationship' && sameRefs(x.refs, c.refs))
      return (rel?.relationship?.type || 'other') === c.relationship_type
    }
    return true
  })
}

// The first question at or after `from` that is asked, or the list length.
function nextAsked(prompts, from, choices) {
  let i = from
  while (i < prompts.length && !isAsked(prompts[i], choices)) i += 1
  return i
}

// The option a saved answer picked, or null: by its text, else (for an
// answer in the sketcher's own words) the "describe" option it came from.
function savedIndex(choice, prompt) {
  if (!choice) return null
  const i = (prompt.options || []).indexOf(choice.response)
  if (i >= 0) return i
  const j = choice.option_index
  return Number.isInteger(j) && prompt.option_actions?.[j] === 'describe' ? j : null
}

/**
 * Guide questions and Help Quest, for the Guide tab of EditSketch.jsx.
 *
 * Questions come in the order of design doc items 15 and 17: how the
 * marked subjects connect (relationship), "What do you
 * see these marks as?" (mark_meaning), other questions about the selected
 * marks, "There is the ... here" (focal_suggestion, with a `suggestion`),
 * then the rest.
 *
 * The AI's reticle: while a question with a `suggestion` or a `spot`
 * shows, onSuggestionChange({ region_ref, x, y }) lets the parent draw it
 * on the photo (AISuggestedReticle); it is called with null otherwise.
 * "Yes, add it" adds the area to the plan as a mark along its outline
 * (source "prompted"), and onMarksChange(marks) passes the saved list up.
 *
 * Options tied to the sketcher's lines (prompt.option_mark_ids, one list
 * of mark ids per option): picking a tied option, or tapping one of its
 * lines on the photo (markTap from the page), selects it and highlights
 * its lines (halo; the rest fade); its ">" button saves it. Options with no
 * lines save at once.
 *
 * review: the sketch is created, so its answers are final. The panel shows
 * each question as it was asked, one at a time with Back and Next: every
 * option, the pick highlighted. Answers saved before the options were kept
 * show only the pick. The answer's lines are highlighted while it shows.
 * "Ask me something else" follows the last one.
 *
 * "Ask me something else" (Help Quest) only shows after the last question,
 * never as one of a question's options.
 *
 * Saved answers (savedChoices, the sketch's session_choices) come back
 * picked: a question already answered opens with that option selected,
 * and its ">" moves on without saving again. Picking another option
 * replaces the answer (the server keeps one per question).
 *
 * The sketcher can mark a spot from Guides, Plan, Mark a spot. `spot` is
 * that spot; it is saved with the answer, then onSpotClear() clears it.
 *
 * An option can carry an overlay (prompt.option_actions, from
 * question_bank.json): picking it calls onAction(name), and the page turns
 * that overlay on. Names: proportions, perspective,
 * value_study, rule_of_thirds, grid.
 */
export default function AIGuidance({
  sketchId,
  referenceImageUrl,
  style,
  analysis,
  onFinished,
  onSuggestionChange,
  onMarksChange,
  // Optional: a "Start Sketching" button after the last question.
  onStartSketching,
  // The sketch's saved answers (session_choices), to show the picks.
  savedChoices = [],
  // Read-only list of the saved answers (the sketch is created).
  review = false,
  onAction,
  // Called with the marks the current question is about (prompt.mark_ids),
  // or [] when none, so the page can highlight them on the photo.
  onHighlight,
  // Called with the question on screen, or null, so the page knows when
  // the sketcher can mark a spot.
  onPromptChange,
  // The sketcher's spot ({ x, y, mark_ids }) or null, and its clear.
  spot = null,
  onSpotClear,
  // The last tap on the photo while a question with tied options shows:
  // { id, n }, id the mark tapped (or null for a miss), n a counter.
  markTap = null,
  // review: the page's footer element. Back and Next render there, at the
  // bottom of the panel. Without it they render under the options.
  footerEl = null,
  // Called with the parts of the scene picked by a tap ([{ id, points }]),
  // or [], so the page can draw their outlines.
  onAnswerObjects,
}) {

  const [promptIndex, setPromptIndex] = useState(0)

  // Help Quest ("Ask me"). 
  const [helpQuestOpen, setHelpQuestOpen] = useState(false)
  const [helpQuestQuestion, setHelpQuestQuestion] = useState('')
  const [helpQuestAnswer, setHelpQuestAnswer] = useState(null)

  // "Something else" (option action "describe"): the sketcher answers in
  // their own words. describing holds the option's index while the text
  // field shows.
  const [describing, setDescribing] = useState(null)
  const [describeText, setDescribeText] = useState('')

  // A tied option the sketcher picked (button or tap on its lines),
  // waiting for Continue; else null. tapMiss: the last tap hit no tied line.
  const [chosen, setChosen] = useState(null)
  const [tapMiss, setTapMiss] = useState(false)
  // Answers saved so far, kept up to date as the sketcher answers.
  const [choices, setChoices] = useState(savedChoices)
  // review: which saved answer is on screen.
  const [reviewIndex, setReviewIndex] = useState(0)
  // principle_intent: the last pick would go over the cap ("3 is the most
  // for one plan").
  const [atCap, setAtCap] = useState(false)
  // Answer by tapping the photo (tap_answer): the marks and scene objects
  // picked so far, in tap order ([{ kind, id }]). A second tap removes one.
  const [tapped, setTapped] = useState([])
  // The own-words row: its text, and whether a tap on empty space asked
  // "What is here?".
  const [ownText, setOwnText] = useState('')
  const [spotAsked, setSpotAsked] = useState(false)

  // A fresh analysis (first-ever run, or a resume-flow re-run) always
  // starts this flow from a clean slate.
  useEffect(() => {
    setPromptIndex(nextAsked(analysis?.prepared_prompts || [], 0, choices))
    setHelpQuestOpen(false)
    setHelpQuestAnswer(null)
    setDescribing(null)
    setDescribeText('')
    setChosen(null)
    setTapMiss(false)
  }, [analysis])
  // Each question opens with its saved pick, if any. No overlay is turned
  // on for it: that waits for the sketcher to pick.
  useEffect(() => {
    const p = analysis?.prepared_prompts?.[promptIndex]
    const rp = resolvePrompt(p, choices)
    setChosen(rp ? savedIndex(choices.find((c) => sameQuestion(c, rp)), rp) : null)
    setTapMiss(false)
    setAtCap(false)
    // A saved answer by tap or in the sketcher's own words opens the same way.
    const saved = rp ? choices.find((c) => sameQuestion(c, rp)) : null
    setTapped(saved && saved.option_index === -1 && !saved.own_words
      ? [...(saved.mark_ids || []).map((id) => ({ kind: 'mark', id })), ...(saved.object_ids || []).map((id) => ({ kind: 'object', id }))]
      : [])
    setOwnText(saved?.own_words ? saved.response : '')
    setSpotAsked(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptIndex, analysis])

  function currentPrompt() {
    return resolvePrompt(analysis?.prepared_prompts?.[promptIndex], choices)
  }

  // What a tapped mark or scene object is, from the marks analysis: the
  // object a mark belongs to, else the mark's own reading.
  const marksAnalysis = analysis?.marks_analysis
  function describeTap(t) {
    if (t.kind === 'object') {
      const o = (marksAnalysis?.scene_objects || []).find((x) => x.id === t.id)
      return o ? { label: o.label, description: o.description, element: o.element, points: o.points } : null
    }
    const obj = (marksAnalysis?.objects || []).find((x) => x.mark_ids?.includes(t.id))
    if (obj) return { label: obj.name, description: obj.description || obj.name, element: obj.element }
    const m = (marksAnalysis?.marks || []).find((x) => x.mark_id === t.id)
    return m ? { label: m.traces, description: m.traces, element: m.element } : { label: 'your mark', description: 'Your mark', element: null }
  }

  // Show the AI's reticle only while its question is on screen: at a
  // missed focal area (suggestion) or at a spot where the sketcher's lines
  // meet (spot).
  const shown = currentPrompt()
  const spotKey = shown?.spot ? `spot-${shown.spot.x}-${shown.spot.y}` : null
  const currentSuggestion = shown?.suggestion || null
  useEffect(() => {
    if (currentSuggestion) onSuggestionChange?.(currentSuggestion)
    else if (shown?.spot) onSuggestionChange?.({ region_ref: spotKey, x: shown.spot.x, y: shown.spot.y })
    else onSuggestionChange?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSuggestion, spotKey])

  // Which question is on screen (null after the last one).
  useEffect(() => {
    onPromptChange?.(shown && !helpQuestOpen ? shown : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptIndex, analysis, helpQuestOpen])
  useEffect(() => () => onPromptChange?.(null), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onSuggestionChange?.(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  // review: the saved answers in the order the questions were asked
  // (position), each shown the way it was asked.
  const reviewed = review
    ? choices.map((c, i) => ({ ...c, _i: i })).sort((a, b) => (a.position ?? a._i) - (b.position ?? b._i))
    : []

  // Options tied to the sketcher's lines.
  const optionMarks = shown?.option_mark_ids || []
  const linked = optionMarks.some((ids) => ids?.length)

  // Highlight the question's marks while it shows (design doc, item 17):
  // the picked option's lines; none while a tied question waits for a
  // pick (all lines plain); else prompt.mark_ids.
  const highlightKey = (
    review ? reviewed[reviewIndex]?.mark_ids || []
      : tapped.some((t) => t.kind === 'mark') ? tapped.filter((t) => t.kind === 'mark').map((t) => t.id)
      : chosen !== null && optionMarks[chosen]?.length ? optionMarks[chosen]
      : linked ? []
        : shown?.mark_ids || []
  ).join(',')
  useEffect(() => {
    onHighlight?.(highlightKey ? highlightKey.split(',') : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey])

  // Pick a tied option: highlight its lines and show its overlay.
  function chooseOption(index) {
    setChosen(index)
    setTapMiss(false)
    const action = currentPrompt()?.option_actions?.[index]
    if (action && !NOT_OVERLAYS.includes(action)) onAction?.(action)
  }

  // A tap on the photo picks the option whose lines it hit.
  // A tap on the photo while the question takes a tap as its answer: add
  // or remove that mark or scene object, or (empty space) ask "What is
  // here?" in the own-words row.
  useEffect(() => {
    if (!markTap || !shown?.tap_answer || review || helpQuestOpen) return
    setChosen(null)
    setAtCap(false)
    if (markTap.kind === 'spot') {
      setTapped([])
      setSpotAsked(true)
      return
    }
    setSpotAsked(false)
    setOwnText('')
    setTapped((cur) => (cur.some((t) => t.id === markTap.id)
      ? cur.filter((t) => t.id !== markTap.id)
      : [...cur, { kind: markTap.kind, id: markTap.id }]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markTap?.n])
  // The tapped scene objects' outlines, for the page to draw.
  const outlineKey = tapped.filter((t) => t.kind === 'object').map((t) => t.id).join(',')
  useEffect(() => {
    onAnswerObjects?.(tapped.filter((t) => t.kind === 'object').map((t) => ({ id: t.id, points: describeTap(t)?.points || [] })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineKey])
  useEffect(() => () => onAnswerObjects?.([]), []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!markTap || shown?.tap_answer || !linked || describing !== null || helpQuestOpen) return
    const index = optionMarks.findIndex((ids) => ids?.includes(markTap.id))
    if (index >= 0) chooseOption(index)
    else setTapMiss(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markTap?.n])
  useEffect(() => () => onHighlight?.([]), []) // eslint-disable-line react-hooks/exhaustive-deps

  // Principles chosen elsewhere in the plan (not by this question).
  function otherPrinciples(p) {
    const others = choices.filter((c) => !sameQuestion(c, p))
    return new Set(intentsFrom(others).map((i) => i.principle))
  }

  // Back to the previous question that was asked. Its saved pick shows,
  // and picking again replaces it.
  function previousAsked() {
    const prompts = analysis?.prepared_prompts || []
    let i = Math.min(promptIndex, prompts.length) - 1
    while (i >= 0 && !isAsked(prompts[i], choices)) i -= 1
    return i
  }

  function goBack() {
    const prev = previousAsked()
    if (prev < 0) return
    setDescribing(null)
    setDescribeText('')
    setPromptIndex(prev)
  }

  function advancePrompt(latest = choices) {
    const next = nextAsked(analysis?.prepared_prompts || [], promptIndex + 1, latest)
    // Past the last question, the panel shows its closing note.
    setPromptIndex(next)
    if (!analysis || next >= analysis.prepared_prompts.length) onFinished?.()
  }

  // Saved server-side so the critique call can read it later.
  // Not awaited: a failed save never blocks the sketcher.
  function handlePromptSelect(option, index) {
    const prompt = currentPrompt()
    const action = prompt.option_actions?.[index]
    // "Something else": ask for their own words before saving anything.
    if (action === 'describe') {
      setDescribing(index)
      setDescribeText('')
      return
    }
    // "What do you want these marks to do?" (principle_intent): one tap picks
    // a principle, or "Not sure yet", and moves on. Up to max_principles
    // across the whole plan.
    if (prompt.key === 'principle_intent' && prompt.option_principles?.length) {
      const undecided = index === prompt.undecided_option
      const principle = prompt.option_principles[index]
      if (!undecided) {
        const total = new Set([...otherPrinciples(prompt), principle])
        if (total.size > (prompt.max_principles || 3)) {
          setAtCap(true)
          return
        }
      }
      const latest = saveAnswer(prompt, option, index, {
        principles: undecided || !principle ? [] : [principle],
        undecided_principle: undecided || undefined,
        element: prompt.option_elements?.[index] || undefined,
        principle: principle || undefined,
        relationship_type: prompt.relationship_type || undefined,
      })
      advancePrompt(latest)
      return
    }
    // Seeing as: the reading's element and short name ({A} or {B} later).
    // Seeing that: the relationship type, with its element and principle.
    if (prompt.key === 'mark_meaning' && prompt.option_names?.length) {
      advancePrompt(saveAnswer(prompt, option, index, {
        name: prompt.option_names[index], element: prompt.option_elements?.[index] || undefined,
      }))
      return
    }
    if (prompt.key === 'relationship' && prompt.option_types?.length) {
      advancePrompt(saveAnswer(prompt, option, index, {
        relationship: {
          type: prompt.option_types[index],
          element: prompt.option_elements?.[index],
          principle: prompt.option_principles?.[index],
          subjects: Object.values(prompt.names || {}).filter(Boolean),
        },
      }))
      return
    }
    // Tied to lines: select it and wait for Continue.
    if (optionMarks[index]?.length) {
      chooseOption(index)
      return
    }
    const before = savedIndex(choices.find((c) => sameQuestion(c, prompt)), prompt)
    const latest = saveAnswer(prompt, option, index)
    if (action && !NOT_OVERLAYS.includes(action)) onAction?.(action)
    // Back, then away from "Yes, add it": the mark it added comes off the plan.
    if (prompt.suggestion && before === 0 && index !== 0) {
      api.delete(`/api/sketches/${sketchId}/marks/adopt/${prompt.suggestion.region_ref}`)
        .then(({ data }) => onMarksChange?.(data.marks))
        .catch((err) => console.warn('Could not remove the area from the plan', err))
    }
    // "Yes, add it" to "There is the ... here": the first option. The
    // area becomes a mark along its outline, in the normal mark colour.
    if (prompt.suggestion && index === 0) {
      const color = getComputedStyle(document.documentElement).getPropertyValue('--mark-color').trim() || '#fde68a'
      api.post(`/api/sketches/${sketchId}/marks/adopt`, {
        region_ref: prompt.suggestion.region_ref,
        color,
        size_mm: 1,
      })
        .then(({ data }) => onMarksChange?.(data.marks))
        .catch((err) => console.warn('Could not add the area to the plan', err))
    }
    advancePrompt(latest)
  }

  // ">" on the tapped rows: the picked marks and scene objects are the
  // answer. Their labels make its name; the first one's element stands in
  // for the step's element.
  function saveTapped() {
    const prompt = currentPrompt()
    const rows = tapped.map((t) => ({ ...t, ...describeTap(t) }))
    if (!rows.length) return
    const label = rows.map((r) => r.label).join(' and ')
    const extra = {
      name: label,
      element: rows[0].element || prompt.option_elements?.[0] || undefined,
      object_ids: rows.filter((r) => r.kind === 'object').map((r) => r.id),
      mark_ids: rows.filter((r) => r.kind === 'mark').map((r) => r.id),
    }
    if (prompt.key === 'principle_intent') extra.relationship_type = prompt.relationship_type
    advancePrompt(saveAnswer(prompt, label.charAt(0).toUpperCase() + label.slice(1), -1, extra))
  }

  // ">" (or Enter) in the own-words row. In step 1 the words name the
  // object; their element falls back to the AI's best reading.
  function saveOwnWords() {
    const prompt = currentPrompt()
    const text = ownText.trim()
    if (!text) return
    const extra = { own_words: true, element: prompt.option_elements?.[0] || undefined }
    if (prompt.key === 'mark_meaning') extra.name = text
    if (prompt.key === 'principle_intent') extra.relationship_type = prompt.relationship_type
    advancePrompt(saveAnswer(prompt, text, -1, extra))
  }

  // The sketcher's own words for "Something else". Saved as the answer,
  // so the critique reads what they saw in their words (item 17).
  function handleDescribeSubmit() {
    const text = describeText.trim()
    if (!text) return
    const latest = saveAnswer(currentPrompt(), text, describing)
    setDescribing(null)
    setDescribeText('')
    advancePrompt(latest)
  }

  // Returns the answers with this one in, so the next question can be
  // picked before the state updates (a seed question may now be asked).
  function saveAnswer(prompt, response, index, extra = {}) {
    const markIds = prompt.option_mark_ids?.[index] || prompt.mark_ids || []
    const latest = withoutStaleSeeds([
      ...choices.filter((c) => !sameQuestion(c, prompt)),
      {
        key: prompt.key, prompt: prompt.question, response, option_index: index,
        mark_ids: markIds, relationship: prompt.relationship || undefined,
        requires_principle: prompt.requires_principle || undefined, refs: refsOf(prompt),
        shape_id: prompt.shape_id || undefined,
        options: prompt.options, option_hints: prompt.option_hints, position: promptIndex, ...extra,
      },
    ])
    setChoices(latest)
    api.post(`/api/sketches/${sketchId}/session-choices`, {
      prompt: prompt.question,
      response,
      key: prompt.key,
      // "unseen": the AI raised something the sketcher had not marked. The
      // "There is the ... here" questions are unseen until scene analysis sends
      // a focus on every question. A yes to one is "prompted" evidence.
      focus: prompt.focus || (prompt.suggestion ? 'unseen' : undefined),
      option_index: index,
      mark_ids: markIds,
      // The spot the question pointed at, and the one the sketcher marked.
      ai_spot: prompt.spot || undefined,
      spot: spot || undefined,
      // The relationship question's kind, principle and subjects, so the
      // critique knows which connection the sketcher was answering about.
      relationship: prompt.relationship || undefined,
      // Marks analysis (item 20): the shape, the question's matrix cell,
      // and for principle_intent the picks or "Not sure yet".
      shape_id: prompt.shape_id || undefined,
      element: prompt.element || undefined,
      principle: prompt.principle || undefined,
      requires_principle: prompt.requires_principle || undefined,
      // The whole question as asked, so Edit Sketch can show every option
      // with the pick highlighted, not only the pick.
      options: prompt.options || [],
      option_hints: prompt.option_hints?.length ? prompt.option_hints : undefined,
      option_actions: prompt.option_actions?.length ? prompt.option_actions : undefined,
      position: promptIndex,
      refs: refsOf(prompt),
      ...extra,
    }).catch((err) => {
      console.warn('Could not save session choice', err)
      // The server enforces the cap too ("3 is the most for one plan").
      if (err.response?.status === 422) setAtCap(true)
    })
    onSpotClear?.()
    return latest
  }

  // ">": save the pick, then the next question. The saved pick, unchanged,
  // just moves on (re-saving would lose words typed for "Something else").
  function handleChosenContinue() {
    const prompt = currentPrompt()
    const saved = savedIndex(choices.find((c) => sameQuestion(c, prompt)), prompt)
    const latest = chosen !== saved ? saveAnswer(prompt, prompt.options[chosen], chosen) : choices
    advancePrompt(latest)
  }

  async function handleHelpQuestSend() {
    if (!helpQuestQuestion.trim()) return
    try {
      // No image: the backend builds it from the saved sketch (reference
      // photo + focal points + marks -- services/composite.py).
      const form = new FormData()
      form.append('sketch_id', sketchId)
      form.append('question', helpQuestQuestion)
      form.append('style', style)
      form.append('scene_type', analysis.scene_type)
      form.append('step_id', `prompt-${promptIndex}`)
      const { data } = await api.post('/api/help-quest', form)
      setHelpQuestAnswer(data.answer)
    } catch {
      setHelpQuestAnswer('Could not reach Help Quest right now.')
    }
  }

  const prompt = currentPrompt()

  // Debug mode only (DEBUG=true in backend/.env): the option's element, and
  // its principle when it has one, in line after the text.
  function debugTag(p, i) {
    if (!analysis?.marks_analysis?.debug) return null
    const el = p.option_elements?.[i]
    const pr = p.option_principles?.[i]
    const tag = [el, pr].filter(Boolean).join(', ')
    return tag ? <span className="sc-option-tag">[{tag}]</span> : null
  }

  // Back to the previous question. Hidden on the first one.
  const backButton = !review && previousAsked() >= 0 ? (
    <Button variant="quietOnDark" className="-ml-3 flex items-center gap-1 self-start" onClick={goBack}>
      <Icon name="chevron-left" size={14} />
      Back
    </Button>
  ) : null

  // Guide question panel (design handoff): the question, an optional
  // principle line (prompt.principle and prompt.principle_text, when the
  // scene analysis sends them), then the answers. "Ask me something else"
  // opens Help Quest. The page's panel supplies the padding.
  return (
    <div className="flex flex-col gap-3.5">
      {!analysis ? (
        <p className="sc-body">Preparing your questions…</p>
      ) : (
        <>
          {review && !helpQuestOpen && (
            // Read only, one question at a time, the way it was asked: every
            // option shows, the sketcher's pick highlighted, so the other
            // choices stay visible to learn from. Back and Next step through.
            <div key={reviewIndex} className="flex animate-fade-in-up flex-col gap-3.5">
              {reviewed.length === 0 ? (
                <p className="sc-body">No guided answers were saved for this sketch.</p>
              ) : (() => {
                const c = reviewed[Math.min(reviewIndex, reviewed.length - 1)]
                // Answers saved before options were kept show only the pick.
                const options = c.options?.length ? c.options : [c.response]
                const at = options.indexOf(c.response)
                const picked = at >= 0 ? at : Number.isInteger(c.option_index) ? c.option_index : 0
                const ownWords = options[picked] !== c.response
                const last = reviewIndex >= reviewed.length - 1
                return (
                  <>
                    <p className="text-base text-sc-text3">Question {reviewIndex + 1} of {reviewed.length}</p>
                    <p className="font-heading text-question font-bold text-white">{c.prompt}</p>
                    <div className="mt-1 flex flex-col gap-2">
                      {options.map((opt, i) => (
                        <Button
                          key={`${opt}-${i}`}
                          variant="choice"
                          active={i === picked}
                          aria-current={i === picked ? 'true' : undefined}
                          // Read only: the pick is highlighted, the rest disabled.
                          disabled={i !== picked}
                          className="pointer-events-none"
                          tabIndex={-1}
                        >
                          <span className="block">{opt}</span>
                          {c.option_hints?.[i] && (
                            <span className="block text-base font-normal text-sc-text3">{c.option_hints[i]}</span>
                          )}
                        </Button>
                      ))}
                      {ownWords && (
                        <p className="rounded-xl bg-sc-raised p-3.5 text-md leading-normal text-sc-text">{c.response}</p>
                      )}
                    </div>
                    {last && (
                      <Button variant="choice" onClick={() => setHelpQuestOpen(true)}>
                        Ask me something else
                      </Button>
                    )}
                    {/* Back and Next on one row, anchored at the bottom right
                        of the panel (footerEl), so the question sits up top. */}
                    {(() => {
                      const nav = (reviewIndex > 0 || !last) ? (
                        <>
                          {reviewIndex > 0 ? (
                            <Button variant="quietOnDark" className="flex items-center gap-1" onClick={() => setReviewIndex((i) => i - 1)}>
                              <Icon name="chevron-left" size={14} />
                              Back
                            </Button>
                          ) : <span />}
                          {!last && (
                            <Button variant="secondaryOnDark" className="flex items-center gap-1" onClick={() => setReviewIndex((i) => i + 1)}>
                              Next
                              <Icon name="chevron-right" size={14} />
                            </Button>
                          )}
                        </>
                      ) : null
                      if (!nav) return null
                      return footerEl ? createPortal(nav, footerEl) : <div className="flex items-center justify-between">{nav}</div>
                    })()}
                  </>
                )
              })()}
              {reviewed.length === 0 && (
                <Button variant="choice" onClick={() => setHelpQuestOpen(true)}>
                  Ask me something else
                </Button>
              )}
            </div>
          )}

          {!review && prompt && !helpQuestOpen && (
            <div key={promptIndex} className="flex animate-fade-in-up flex-col gap-3.5">
              {backButton}
              <p className="font-heading text-question font-bold text-white">{prompt.question}</p>
              {prompt.principle && prompt.principle_text && (
                <p className="text-base text-sc-text3">
                  <span className="font-bold capitalize text-sc-guide">{prompt.principle}:</span> 
                  {prompt.principle_text}
                </p>
              )}
              {describing !== null ? (
                <div className="mt-1 flex flex-col gap-2">
                  <input
                    autoFocus
                    value={describeText}
                    onChange={(e) => setDescribeText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleDescribeSubmit() }}
                    placeholder="In your own words"
                    aria-label="Your answer"
                    maxLength={200}
                    className="sc-field"
                  />
                  <div className="flex gap-2 self-end">
                    <Button variant="secondaryOnDark" onClick={() => { setDescribing(null); setDescribeText('') }}>Back</Button>
                    <Button variant="action" onClick={handleDescribeSubmit} disabled={!describeText.trim()}>Save</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex flex-col gap-2">
                  {(prompt.options || []).map((opt, i) => (
                    <Button
                      key={opt}
                      variant="choice"
                      active={chosen === i}
                      aria-pressed={optionMarks[i]?.length ? chosen === i : undefined}
                      onClick={() => handlePromptSelect(opt, i)}
                      // A picked option tied to lines: ">" saves it and moves on.
                      onNext={chosen === i ? handleChosenContinue : undefined}
                    >
                      <span className="block">
                        {opt}
                        {debugTag(prompt, i)}
                      </span>
                      {prompt.option_hints?.[i] && <span className="sc-option-note">{prompt.option_hints[i]}</span>}
                    </Button>
                  ))}
                  {/* Rows added by tapping the photo: picked at once. A tap on
                      the row, or on the same mark or object again, removes it.
                      The last row's ">" saves them as the answer. */}
                  {tapped.map((t, i) => {
                    const d = describeTap(t)
                    return (
                      <Button
                        key={`${t.kind}-${t.id}`}
                        variant="choice"
                        active
                        aria-pressed
                        onClick={() => setTapped((cur) => cur.filter((x) => x.id !== t.id))}
                        onNext={i === tapped.length - 1 ? saveTapped : undefined}
                      >
                        <span className="block">
                          {d?.description}
                          {analysis?.marks_analysis?.debug && d?.element && <span className="sc-option-tag">[{d.element}]</span>}
                        </span>
                      </Button>
                    )
                  })}
                  {/* The sketcher's own words: always the last row. */}
                  {prompt.own_words && (
                    <label className="sc-own-words" data-active={Boolean(ownText.trim() || spotAsked)}>
                      <Icon name="pen" size={16} className="shrink-0 text-sc-text3" />
                      <input
                        value={ownText}
                        autoFocus={spotAsked}
                        key={spotAsked ? 'spot' : 'words'}
                        onChange={(e) => {
                          setOwnText(e.target.value)
                          if (e.target.value.trim()) { setTapped([]); setChosen(null) }
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveOwnWords() }}
                        placeholder={spotAsked ? prompt.spot_placeholder : prompt.own_words_placeholder}
                        aria-label="Your own words"
                        maxLength={prompt.own_words_max || 200}
                      />
                      {ownText.trim() && <NextButton onClick={saveOwnWords} />}
                    </label>
                  )}
                  {atCap && (
                    <p className="text-base text-sc-text3" aria-live="polite">
                      {prompt.max_principles || 3} is the most for one plan.
                    </p>
                  )}
                  {tapMiss && (
                    <p className="text-base text-sc-text3" aria-live="polite">
                      Tap one of the lines you drew for these answers.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!review && !prompt && !helpQuestOpen && (
            <div className="flex animate-fade-in-up flex-col gap-3">
              {backButton}
              <p className="font-heading text-question font-bold text-white">That's all for now.</p>
              <p className="sc-body">Open Guides on the photo any time. Ask a question whenever you get stuck.</p>
              {analysis.prepared_prompts.length > 0 && (
                <Button variant="choice" onClick={() => setPromptIndex(nextAsked(analysis.prepared_prompts, 0, choices))}>
                  Go through the questions again
                </Button>
              )}
              <Button variant="choice" onClick={() => setHelpQuestOpen(true)}>
                Ask me something else
              </Button>
              {onStartSketching && (
                <Button variant="action" className="self-start" onClick={onStartSketching}>
                  Start Sketching
                </Button>
              )}
            </div>
          )}

          {helpQuestOpen && (
            <div className="flex animate-fade-in-up flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-heading text-question font-bold text-white">Ask about this scene</p>
                <button
                  type="button"
                  aria-label="Back to questions"
                  onClick={() => { setHelpQuestOpen(false); setHelpQuestAnswer(null) }}
                  className="flex h-11 w-11 items-center justify-center text-sc-text3 hover:text-white"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
              {helpQuestAnswer ? (
                <>
                  <p className="rounded-xl bg-sc-raised p-3.5 text-md leading-normal text-sc-text">{helpQuestAnswer}</p>
                  <Button
                    variant="secondaryOnDark"
                    className="self-start"
                    onClick={() => { setHelpQuestOpen(false); setHelpQuestAnswer(null); setHelpQuestQuestion('') }}
                  >
                    Back to questions
                  </Button>
                </>
              ) : (
                <>
                  <input
                    autoFocus
                    value={helpQuestQuestion}
                    onChange={(e) => setHelpQuestQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleHelpQuestSend() }}
                    placeholder="e.g. Should I start with the wine bottles?"
                    aria-label="Your question"
                    className="sc-field"
                  />
                  <Button variant="action" className="self-end" onClick={handleHelpQuestSend}>Ask</Button>
                </>
              )}
            </div>
          )}

          {analysis?.debug_raw_gemini_response && (
            <details className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-white/60">Debug: raw Gemini response</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-white/70">
                {analysis.debug_raw_gemini_response}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  )
}
