// A sketch's date (October 30, 2026): once completed, when its final was
// uploaded; while in progress, when its photo was taken, else when it was
// started. The backend sends it as shown_at (features/sketches/router.py,
// SHOWN_AT); the rest is a fallback for older responses.
export const sketchDate = (s) =>
  s?.shown_at || (s?.final_sketch_url ? s?.final_at : null) || s?.captured_at || s?.created_at
