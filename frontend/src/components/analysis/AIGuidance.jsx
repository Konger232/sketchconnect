import { useEffect, useState } from 'react'
import Icon from '../common/Icon'
import Button from '../common/Button'
import { api } from '../../lib/api'

/**
 * Guide questions and Help Quest, for the Guide tab of EditSketch.jsx.
 *
 * Questions come in the order of design doc items 15 and 17: "What do you
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
 * The sketcher can mark a spot on their own lines while a question shows
 * ("Point at a spot", or Guides, Plan, Mark a spot). `spot` is that spot;
 * it is saved with the answer, then onSpotClear() clears it.
 *
 * An option can carry an overlay (prompt.option_actions, from
 * question_bank.json): picking it calls onAction(name), and the page turns
 * that overlay on. Names: proportions, perspective, focal_shapes,
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
  onStartSketching,
  onAction,
  // Called with the marks the current question is about (prompt.mark_ids),
  // or [] when none, so the page can highlight them on the photo.
  onHighlight,
  // Called with the question on screen, or null, so the page knows when
  // the sketcher can mark a spot.
  onPromptChange,
  // The sketcher's spot ({ x, y, mark_ids }) or null, its clear, and the
  // request to turn on Mark a spot on the photo.
  spot = null,
  onSpotClear,
  onSpotModeRequest,
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

  // A fresh analysis (first-ever run, or a resume-flow re-run) always
  // starts this flow from a clean slate.
  useEffect(() => {
    setPromptIndex(0)
    setHelpQuestOpen(false)
    setHelpQuestAnswer(null)
    setDescribing(null)
    setDescribeText('')
  }, [analysis])

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

  // Highlight the question's marks while it shows (design doc, item 17).
  const currentMarkIds = (currentPrompt()?.mark_ids || []).join(',')
  useEffect(() => {
    onHighlight?.(currentMarkIds ? currentMarkIds.split(',') : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMarkIds])
  useEffect(() => () => onHighlight?.([]), []) // eslint-disable-line react-hooks/exhaustive-deps

  function advancePrompt() {
    const next = promptIndex + 1
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
    saveAnswer(prompt, option, index)
    if (action) onAction?.(action)
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
    advancePrompt()
  }

  // The sketcher's own words for "Something else". Saved as the answer,
  // so the critique reads what they saw in their words (item 17).
  function handleDescribeSubmit() {
    const text = describeText.trim()
    if (!text) return
    saveAnswer(currentPrompt(), text, describing)
    setDescribing(null)
    setDescribeText('')
    advancePrompt()
  }

  function saveAnswer(prompt, response, index) {
    api.post(`/api/sketches/${sketchId}/session-choices`, {
      prompt: prompt.question,
      response,
      key: prompt.key,
      // "unseen": the AI raised something the sketcher had not marked. The
      // "There is the ... here" questions are unseen until scene analysis sends
      // a focus on every question. A yes to one is "prompted" evidence.
      focus: prompt.focus || (prompt.suggestion ? 'unseen' : undefined),
      option_index: index,
      mark_ids: prompt.option_mark_ids?.[index] || prompt.mark_ids || [],
      // The spot the question pointed at, and the one the sketcher marked.
      ai_spot: prompt.spot || undefined,
      spot: spot || undefined,
    }).catch((err) => console.warn('Could not save session choice', err))
    onSpotClear?.()
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
          {prompt && !helpQuestOpen && (
            <div key={promptIndex} className="flex animate-fade-in-up flex-col gap-3.5">
              <p className="font-heading text-question font-bold text-white">{prompt.question}</p>
              {prompt.principle && prompt.principle_text && (
                <p className="text-base text-sc-text3">
                  <span className="font-bold capitalize text-sc-guide">{prompt.principle}:</span> {prompt.principle_text}
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
                    <Button key={opt} variant="choice" onClick={() => handlePromptSelect(opt, i)}>
                      {opt}
                    </Button>
                  ))}
                  <Button variant="choice" onClick={() => setHelpQuestOpen(true)}>
                    Ask me something else
                  </Button>
                  {onSpotModeRequest && (
                    <p className="flex items-center gap-2 text-base text-sc-text3">
                      {spot ? (
                        <>
                          Spot marked on your lines.
                          <button type="button" className="font-semibold text-white underline" onClick={() => onSpotClear?.()}>Clear</button>
                        </>
                      ) : (
                        <button type="button" className="font-semibold text-white underline" onClick={onSpotModeRequest}>
                          Point at a spot on your lines
                        </button>
                      )}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!prompt && !helpQuestOpen && (
            <div className="flex animate-fade-in-up flex-col gap-3">
              <p className="font-heading text-question font-bold text-white">That's all for now.</p>
              <p className="sc-body">Open Guides on the photo any time. Ask a question whenever you get stuck.</p>
              <Button variant="choice" onClick={() => setHelpQuestOpen(true)}>
                Ask me something else
              </Button>
              <Button variant="action" className="self-start" onClick={onStartSketching}>
                Start Sketching
              </Button>
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
