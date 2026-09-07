// UI-facing style labels vs. the API's style enum (gemini_call_schemas.md).
// The Figma prototype's "What is your style?" screen uses the labels on
// the left; the backend only ever sees the enum values on the right.
export const STYLES = [
  { value: 'ink_and_wash', label: 'Line and Wash' },
  { value: 'realistic', label: 'Realism' },
  { value: 'minimalist', label: 'Minimalism' },
  { value: 'reportage', label: 'Reportage' },
]

export const sceneTypeLabel = {
  architectural: 'Architectural',
  still_life_organic: 'Still Life',
  figure: 'Figure',
  open_landscape: 'Open Landscape',
  mixed: 'Mixed',
}
