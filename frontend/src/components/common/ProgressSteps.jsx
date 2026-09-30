import Icon from './Icon'

/**
 * A waiting screen's heading, moving bar and step list (scene analysis in
 * New Sketch, the critique in EditSketch's Feedback tab). Steps before
 * `current` are done (check), `current` spins, the rest wait. Timing comes
 * from useStagedProgress. Look: .sc-progress-bar and .sc-step in index.css.
 *
 *   steps: [{ label, result? }]   result: short text on the right, e.g. a place
 */
export default function ProgressSteps({ heading, steps, current, seconds }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="sc-heading">{heading}</p>
        {seconds > 0 && <span className="text-sm font-semibold tabular-nums text-sc-text3">{seconds}s</span>}
      </div>
      <div className="sc-progress-bar" aria-hidden="true" />
      <div className="sc-steps">
        {steps.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo'
          return (
            <div key={s.label} className="sc-step" data-state={state}>
              <span className="sc-step-dot">{state === 'done' && <Icon name="check" size={12} />}</span>
              <span className="flex-1">{s.label}</span>
              {s.result && <span className="truncate text-sm font-normal text-sc-text3">{s.result}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
