import { useEffect, useRef, useState } from 'react'
import Button from '../common/Button'

const RETICLE_SIZE = 60
const RETICLE_REACH = 16

export function Reticle({ x, y }) {
  // The enclosing SVG stretches its 0-1000 viewBox independently in x and
  // y to fill whatever pixel box it's actually rendered at
  // (preserveAspectRatio="none" -- needed so x/y line up with real
  // percentages of the container, which is how points are captured in
  // the first place). That means equal width/height in viewBox units
  // comes out looking stretched unless the panel happens to be square.
  // `aspect` (the panel's real width/height in pixels) lets us
  // pre-compensate every vertical measurement so the reticle renders as
  // an actual square on screen.
  const gRef = useRef(null)
  const [aspect, setAspect] = useState(1)

  useEffect(() => {
    const svg = gRef.current?.ownerSVGElement
    if (!svg) return
    const measure = () => {
      const rect = svg.getBoundingClientRect()
      if (rect.width && rect.height) setAspect(rect.width / rect.height)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  const halfX = RETICLE_SIZE / 2
  const halfY = halfX * aspect
  const outerX = halfX + RETICLE_REACH
  const outerY = halfY + RETICLE_REACH * aspect

  return (
    <g
      ref={gRef}
      stroke="var(--focal-accent-user)"
      strokeWidth="var(--focal-reticle-stroke-width)"
      strokeOpacity="var(--focal-reticle-stroke-opacity)"
      fill="var(--focal-accent-user)"
      fillOpacity="var(--focal-reticle-fill-opacity)"
      vectorEffect="non-scaling-stroke"
    >
      <rect x={x - halfX} y={y - halfY} width={RETICLE_SIZE} height={halfY * 2} />
      <line x1={x - outerX} y1={y} x2={x + outerX} y2={y} />
      <line x1={x} y1={y - outerY} x2={x} y2={y + outerY} />
      <ellipse cx={x} cy={y} rx={3} ry={3 * aspect} stroke="none" fill="var(--focal-accent-user)" fillOpacity="var(--focal-reticle-fill-opacity)" vectorEffect="non-scaling-stroke" />
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
    <div>
     {/* <div className="flex flex-col justify-center gap-4 bg-white p-5 text-ink md:p-6"> */}
    
      {phase === 'mark-placing' && (
        <div className="animate-fade-in-up">
          <h2 className="panel-label text-sm text-white/80">Mark your focal points</h2>
          <p className="mt-2 text-sm text-white/70">
            Tap the photo for what catches your eye. Gemini will ask about anything you missed once you continue.
          </p>
          <p className="mt-3 text-xs text-white/50">
            Your own: {ownPoints.length} / {ownPointCap}
            {ownPoints.length >= ownPointCap && ' — tap a marker to remove it and free up a spot'}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Button variant="linkOnDark" onClick={onSkip} className="font-medium">
              Skip this step
            </Button>
            <Button variant="primaryOnDark" size="sm" onClick={onMarkContinue}>Continue</Button>
          </div>
        </div>
      )}

      {phase === 'mark-asking' && (
        <div className="animate-fade-in-up">
          <p className="panel-label">
            Question {markQuestionPos + 1} of {pendingMarkQuestions.length}
          </p>
          <p className="mt-1 text-base font-semibold leading-snug">
            Have you noticed the {regions[pendingMarkQuestions[markQuestionPos]]?.label}? 
            Do you want to add it as a focal point?
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="outlineOnDark" size="sm" className="flex-1" onClick={() => answerMarkQuestion(false)}>
              No thanks
            </Button>
            <Button variant="primaryOnDark" size="sm" className="flex-1" onClick={() => answerMarkQuestion(true)}>
              Yes, add it
            </Button>
          </div>
        </div>
      )}

      {phase === 'frame-adjusting' && (
        <div className="animate-fade-in-up">
          <h2 className="panel-label text-sm text-white/80">
            Fine-tune the frame
          </h2>
          <p className="mt-2 text-xs text-white/60">
            Drag the photo to pan, or use the slider to zoom — watch how your points sit against the rule-of-thirds
            grid. Moving one out of frame will ask before letting it go.
          </p>
          {/* <Button
            variant="pill"
            active={showGrid}
            type="button"
            onClick={() => setShowGrid((v) => !v)}
            className="mt-3 self-start font-medium"
          >
            Rule of thirds grid: {showGrid ? 'On' : 'Off'}
          </Button> */}
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs text-white/40">−</span>
            <input
              type="range"
              min={minZoom}
              max={maxZoom}
              step={0.01}
              value={zoom}
              onPointerDown={handleZoomSliderStart}
              onChange={handleZoomSliderChange}
              onPointerUp={handleZoomSliderCommit}
              className="h-1.5 flex-1 accent-white"
              aria-label="Zoom"
            />
            <span className="text-xs text-white/40">+</span>
          </div>
          <span className="text-xs text-white/40 items-center">{zoom}</span>
          <Button variant="primaryOnDark" size="sm" className="mt-4 w-full" onClick={handleConfirmFrame} disabled={saving}>
            {saving ? 'Saving…' : 'Confirm framing'}
          </Button>
        </div>
      )}

      {phase === 'frame-asking' && (
        <div className="animate-fade-in-up">
          <p className="panel-label">
            Question {frameQuestionPos + 1} of {frameQuestionQueue.length}
          </p>
          <p className="mt-1 text-base font-semibold leading-snug">
            You've moved {anchorLabel(frameQuestionQueue[frameQuestionPos])} out of frame — not interested in that
            area anymore?
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="outlineOnDark" size="sm" className="flex-1" onClick={handleFrameKeep}>
              No, keep it in frame
            </Button>
            <Button variant="primaryOnDark" size="sm" className="flex-1" onClick={handleFrameRemove}>
              Correct, remove it
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-accent">{error}</p>}
    </div>
  )
}