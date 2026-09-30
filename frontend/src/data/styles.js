// UI-facing style labels vs. the API's style enum (gemini_call_schemas.md).
// The Figma prototype's "What is your style?" screen uses the labels on
// the left; the backend only ever sees the enum values on the right.
export const STYLES = [
  // desc: the one line under the name on the New Sketch style cards.
  { value: 'realistic', label: 'Realism', desc: 'Accurate proportion and tone' },
  { value: 'ink_and_wash', label: 'Line and Wash', desc: 'Ink lines, loose watercolor' },
  { value: 'minimalist', label: 'Minimalist', desc: 'Few lines, lots of paper' },
  { value: 'reportage', label: 'Reportage', desc: 'Quick, on-the-spot story' },
]

export const sceneTypeLabel = {
  architectural: 'Architectural',
  still_life_organic: 'Still Life',
  figure: 'Figure',
  open_landscape: 'Open Landscape',
  mixed: 'Mixed',
}
