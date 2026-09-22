// Three dots that bounce in sequence, used after a "Looking at your
// scene…"-style label to show ongoing work during a Gemini call that can
// take a few seconds -- the entrance animations in tailwind.config.js
// (fadeInUp/fadeInScale) only play once, so this is the one looping
// animation in the motion vocabulary, kept to its own small component so
// every wait-on-Gemini label (StylePicker, SketchFlowPage) uses the same one.
export default function LoadingDots({ className = '' }) {
  return (
    <span className={`inline-flex ${className}`} aria-hidden="true">
      <span className="animate-bounce-dot">.</span>
      <span className="animate-bounce-dot [animation-delay:0.15s]">.</span>
      <span className="animate-bounce-dot [animation-delay:0.3s]">.</span>
    </span>
  )
}
