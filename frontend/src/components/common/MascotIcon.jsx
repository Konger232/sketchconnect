// The small ink-pot-with-sparkles mark that marks "the AI is speaking" in
// every guided prompt throughout the Figma prototype (Ready to sketch?,
// Tell us where you captured this photo?, What is your style?, etc.).
// Kept as its own component so every AI-voiced surface uses one glyph.
export default function MascotIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M9 21v-6a3 3 0 0 1 3-3v0a3 3 0 0 1 3 3v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 21h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 12 8 6c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2l-1 6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4 4l1 1M4 8l1.4-.4M19 3l-1 1.4M20 7l-1.6.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
