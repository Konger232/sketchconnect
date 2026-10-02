import { useEffect, useState } from 'react'
import Icon from '../common/Icon'
import Button from '../common/Button'
import { api } from '../../lib/api'

// Asked once per selected shape or missed area, so the question text tells
// them apart. Matched with _repeated_keys in backend sketches/router.py.
// Marks analysis questions about one shape (shape_id) or gated on a
// principle (requires_principle) repeat the same way.
const REPEATED_KEYS = ['mark_meaning', 'focal_suggestion', 'principle_intent', 'unseen']

function isRepeated(prompt) {
  return REPEATED_KEYS.includes(prompt.key) || Boolean(prompt.shape_id || prompt.requires_principle)
}

function sameQuestion(choice, prompt) {
  if (!choice || !prompt || choice.key !== prompt.key) return false
  return !isRepeated(prompt) || choice.prompt === prompt.question
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
    if (c.key === 'relationship' && c.option_index === 0 && c.relationship?.principle) {
      out.push({ principle: c.relationship.principle, mark_ids: c.mark_ids || [] })
    }
  }
  return out
}

// A seed question (requires_principle) is asked only when the sketcher
// chose its principle for at least one of its marks.
function isAsked(prompt, choices) {
  if (!prompt?.requires_principle) return true
  const marks = new Set(prompt.mark_ids || [])
  return intentsFrom(choices).some(
    (i) => i.principle === prompt.requires_principle && i.mark_ids.some((id) => marks.has(id)),
  )
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
 * review: the sketch is created, so its answers are final. The panel lists
 * each question with the saved answer; tapping an answer highlights the
 * lines it refers to. "Ask me something else" follows the list.
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
  // review: the answer whose lines are highlighted, or null.
  const [reviewing, setReviewing] = useState(null)
  // principle_intent (multi-select): the picked option indexes, and whether
  // the last pick hit the cap ("3 is the most for one plan").
  const [picks, setPicks] = useState([])
  const [atCap, setAtCap] = useState(false)

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
    setChosen(p ? savedIndex(choices.find((c) => sameQuestion(c, p)), p) : null)
    setTapMiss(false)
    setPicks(p?.multi_select ? initialPicks(p) : [])
    setAtCap(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptIndex, analysis])

  function currentPrompt() {
    return analysis?.prepared_prompts?.[promptIndex] || null
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

  // Options tied to the sketcher's lines.
  const optionMarks = shown?.option_mark_ids || []
  const linked = optionMarks.some((ids) => ids?.length)

  // Highlight the question's marks while it shows (design doc, item 17):
  // the picked option's lines; none while a tied question waits for a
  // pick (all lines plain); else prompt.mark_ids.
  const highlightKey = (
    review ? (reviewing !== null ? choices[reviewing]?.mark_ids || [] : [])
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
  useEffect(() => {
    if (!markTap || !linked || describing !== null || helpQuestOpen) return
    const index = optionMarks.findIndex((ids) => ids?.includes(markTap.id))
    if (index >= 0) chooseOption(index)
    else setTapMiss(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markTap?.n])
  useEffect(() => () => onHighlight?.([]), []) // eslint-disable-line react-hooks/exhaustive-deps

  // principle_intent opens with its saved picks, else with the principles
  // already chosen for these marks (a Yes to the relationship shows as picked).
  function initialPicks(p) {
    const saved = choices.find((c) => sameQuestion(c, p))
    if (saved?.undecided_principle) return [p.undecided_option]
    const marks = new Set(p.mark_ids || [])
    const already = saved
      ? saved.principles || []
      : intentsFrom(choices).filter((i) => i.mark_ids.some((id) => marks.has(id))).map((i) => i.principle)
    return (p.option_principles || []).flatMap((name, i) => (name && already.includes(name) ? [i] : []))
  }

  // Principles chosen elsewhere in the plan (not by this question).
  function otherPrinciples(p) {
    const others = choices.filter((c) => !sameQuestion(c, p))
    return new Set(intentsFrom(others).map((i) => i.principle))
  }

  function togglePick(index) {
    const p = currentPrompt()
    setAtCap(false)
    if (index === p.undecided_option) {
      setPicks((cur) => (cur.includes(index) ? [] : [index]))
      return
    }
    const cur = picks.filter((i) => i !== p.undecided_option)
    if (cur.includes(index)) {
      setPicks(cur.filter((i) => i !== index))
      return
    }
    const total = new Set([...otherPrinciples(p), ...[...cur, index].map((i) => p.option_principles[i])])
    if (total.size > (p.max_principles || 3)) {
      setAtCap(true)
      return
    }
    setPicks([...cur, index])
  }

  function handlePicksDone() {
    const p = currentPrompt()
    if (!picks.length) return
    const undecided = picks.includes(p.undecided_option)
    const ordered = [...picks].sort((a, b) => a - b)
    const next = saveAnswer(p, ordered.map((i) => p.options[i]).join(', '), ordered[0], {
      principles: undecided ? [] : ordered.map((i) => p.option_principles[i]).filter(Boolean),
      undecided_principle: undecided || undefined,
    })
    advancePrompt(next)
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
    // Tied to lines: select it and wait for Continue.
    if (optionMarks[index]?.length) {
      chooseOption(index)
      return
    }
    const latest = saveAnswer(prompt, option, index)
    if (action && !NOT_OVERLAYS.includes(action)) onAction?.(action)
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
    const latest = [
      ...choices.filter((c) => !sameQuestion(c, prompt)),
      {
        key: prompt.key, prompt: prompt.question, response, option_index: index,
        mark_ids: markIds, relationship: prompt.relationship || undefined, ...extra,
      },
    ]
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
            <div className="flex animate-fade-in-up flex-col gap-4">
              <p className="font-heading text-question font-bold text-white">Your answers</p>
              {choices.length === 0 && <p className="sc-body">No guided answers were saved for this sketch.</p>}
              {choices.map((c, i) => (
                <div key={`${c.key}-${i}`} className="flex flex-col gap-2">
                  <p className="text-md font-semibold text-white">{c.prompt}</p>
                  {c.mark_ids?.length ? (
                    // Tap to see the lines this answer refers to.
                    <Button
                      variant="choice"
                      active
                      aria-pressed={reviewing === i}
                      className={reviewing === i ? '' : 'opacity-80'}
                      onClick={() => setReviewing((cur) => (cur === i ? null : i))}
                    >
                      {c.response}
                    </Button>
                  ) : (
                    <p className="flex min-h-[50px] items-center rounded-[10px] border-[1.5px] border-sc-border bg-sc-raised px-3.5 py-2 text-md font-semibold text-white">
                      {c.response}
                    </p>
                  )}
                </div>
              ))}
              <Button variant="choice" onClick={() => setHelpQuestOpen(true)}>
                Ask me something else
              </Button>
            </div>
          )}

          {!review && prompt && !helpQuestOpen && (
            <div key={promptIndex} className="flex animate-fade-in-up flex-col gap-3.5">
              <p className="font-heading text-question font-bold text-white">{prompt.question}</p>
              {prompt.principle && prompt.principle_text && (
                <p className="text-base text-sc-text3">
                  <span className="font-bold capitalize text-sc-guide">{prompt.principle}:</span> 
                  {prompt.principle_text}
                </p>
              )}
              {prompt.multi_select ? (
                // "What do you want these marks to do?" Pick up to
                // max_principles across the plan, or "Not sure yet". Done saves.
                <div className="mt-1 flex flex-col gap-2">
                  {(prompt.options || []).map((opt, i) => (
                    <Button
                      key={opt}
                      variant="choice"
                      active={picks.includes(i)}
                      aria-pressed={picks.includes(i)}
                      onClick={() => togglePick(i)}
                    >
                      <span className="block">{opt}</span>
                      {prompt.option_hints?.[i] && (
                        <span className="block text-base font-normal text-sc-text3">{prompt.option_hints[i]}</span>
                      )}
                    </Button>
                  ))}
                  {atCap && (
                    <p className="text-base text-sc-text3" aria-live="polite">
                      {prompt.max_principles || 3} is the most for one plan.
                    </p>
                  )}
                  <Button variant="action" className="self-end" onClick={handlePicksDone} disabled={!picks.length}>
                    Done
                  </Button>
                </div>
              ) : describing !== null ? (
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
                      {opt}
                    </Button>
                  ))}
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
