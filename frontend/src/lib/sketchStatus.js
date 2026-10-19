// The status label on a sketch card (design doc, items 30 and 38),
// from fields the sketch API already returns.
//
//   Sketching…   the plan is done, nothing uploaded yet
//   In progress  at least one progress sketch, no final
//   Complete     the final sketch is in; the sketch is shared
//
// `upload_count` comes with the owner's own lists (GET /api/sketches and
// the Sketcher page). Without it, an unshared sketch reads Sketching….
export const SKETCH_STATUS = {
  SKETCHING: 'Sketching…',
  IN_PROGRESS: 'In progress',
  COMPLETE: 'Complete',
}

export function getSketchStatus(sketch) {
  if (sketch.final_sketch_url) return SKETCH_STATUS.COMPLETE
  if (sketch.upload_count > 0) return SKETCH_STATUS.IN_PROGRESS
  return SKETCH_STATUS.SKETCHING
}
