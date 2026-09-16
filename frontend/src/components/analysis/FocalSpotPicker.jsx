import Button from '../common/Button'

const RETICLE_SIZE = 60
const RETICLE_REACH = 16

export function Reticle({ x, y }) {
  const half = RETICLE_SIZE / 2
  const outer = half + RETICLE_REACH
  return (
    <g
      stroke="var(--focal-accent-user)"
      strokeWidth="var(--focal-reticle-stroke-width)"
      strokeOpacity="var(--focal-reticle-stroke-opacity)"
      fill="none"
      vectorEffect="non-scaling-stroke"
    >
      <rect x={x - half} y={y - half} width={RETICLE_SIZE} height={RETICLE_SIZE} />
      <line x1={x - outer} y1={y} x2={x + outer} y2={y} />
      <line x1={x} y1={y - outer} x2={x} y2={y + outer} />
      <circle cx={x} cy={y} r={3} stroke="none" fill="var(--focal-accent-user)" fillOpacity="var(--focal-reticle-stroke-opacity)" vectorEffect="non-scaling-stroke" />
    </g>
  )
}

export default function FocalSpotPicker({
  phase,
  onRetake,
  ownPoints,
  ownPointCap,
  onSkip,
  onMarkContinue,
  pendingMarkQuestions,
  markQuestionPos,
  regions,
  answerMarkQuestion,
  showGrid,
  setShowGrid,
  minZoom,
  maxZoom,
  zoom,
  handleZoomSliderStart,
  handleZoomSliderChange,
  handleZoomSliderCommit,
  handleConfirmFrame,
  saving,
  frameQuestionPos,
  frameQuestionQueue,
  anchorLabel,
  handleFrameKeep,
  handleFrameRemove,
  error,
}) {
  return (
    <div className="flex flex-col justify-center gap-4 bg-white p-5 text-ink md:p-6">
    
      {phase === 'mark-placing' && (
        <div className="animate-fade-in-up">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Mark your focal points</h2>
          <p className="mt-2 text-sm text-ink/70">
            Tap the photo for what catches your eye. Gemini will ask about anything you missed once you continue.
          </p>
          <p className="mt-3 text-xs text-ink/50">
            Your own: {ownPoints.length} / {ownPointCap}
            {ownPoints.length >= ownPointCap && ' — tap a marker to remove it and free up a spot'}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={onSkip} className="text-sm font-medium text-ink/50 hover:text-ink">
              Skip this step
            </button>
            <Button size="sm" onClick={onMarkContinue}>Continue</Button>
          </div>
        </div>
      )}

      {phase === 'mark-asking' && (
        <div className="animate-fade-in-up">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Question {markQuestionPos + 1} of {pendingMarkQuestions.length}
          </p>
          <p className="mt-1 text-base font-semibold leading-snug">
            Gemini also noticed {regions[pendingMarkQuestions[markQuestionPos]]?.label} — add it as a focal point?
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => answerMarkQuestion(false)}>
              No thanks
            </Button>
            <Button size="sm" className="flex-1" onClick={() => answerMarkQuestion(true)}>
              Yes, add it
            </Button>
          </div>
        </div>
      )}

      {phase === 'frame-adjusting' && (
        <div className="animate-fade-in-up">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Fine-tune the frame</h2>
          <p className="mt-2 text-xs text-ink/60">
            Drag the photo to pan, or use the slider to zoom — watch how your points sit against the rule-of-thirds
            grid. Moving one out of frame will ask before letting it go.
          </p>
          <button
            type="button"
            onClick={() => setShowGrid((v) => !v)}
            className={`mt-3 self-start rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              showGrid ? 'bg-ink text-white' : 'bg-ink/10 text-ink/60 hover:bg-ink/20'
            }`}
          >
            Rule of thirds grid: {showGrid ? 'On' : 'Off'}
          </button>
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs text-ink/40">−</span>
            <input
              type="range"
              min={minZoom}
              max={maxZoom}
              step={0.01}
              value={zoom}
              onPointerDown={handleZoomSliderStart}
              onChange={handleZoomSliderChange}
              onPointerUp={handleZoomSliderCommit}
              className="h-1.5 flex-1 accent-ink"
              aria-label="Zoom"
            />
            <span className="text-xs text-ink/40">+</span>
          </div>
          <span className="text-xs text-ink/40 items-center">{zoom}</span>
          <Button size="sm" className="mt-4 w-full" onClick={handleConfirmFrame} disabled={saving}>
            {saving ? 'Saving…' : 'Confirm framing'}
          </Button>
        </div>
      )}

      {phase === 'frame-asking' && (
        <div className="animate-fade-in-up">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Question {frameQuestionPos + 1} of {frameQuestionQueue.length}
          </p>
          <p className="mt-1 text-base font-semibold leading-snug">
            You've moved {anchorLabel(frameQuestionQueue[frameQuestionPos])} out of frame — not interested in that
            area anymore?
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={handleFrameKeep}>
              No, keep it in frame
            </Button>
            <Button size="sm" className="flex-1" onClick={handleFrameRemove}>
              Correct, remove it
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-accent">{error}</p>}
    </div>
  )
}