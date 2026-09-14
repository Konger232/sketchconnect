// Home-page lifecycle status, derived entirely client-side from fields
// the Sketch API already returns -- no new backend column. Every stage
// here is reconstructible from a fixed, monotonically-advancing set of
// nullable fields (style -> scene_type -> final_sketch_url -> title),
// there's no branching lifecycle (no "abandoned"/"archived" states), and
// nothing on the home feed needs to filter or sort by stage server-side,
// so a real status column would only buy a manual Supabase migration
// (schema.sql's defensive ALTER TABLE precedent) for a purely
// presentational label. Revisit only if a future feature needs to query
// by stage server-side.
//
// Note: `_sketch_to_dict` (backend/app/routers/sketches.py) does NOT
// serialize `cached_scene_analysis` or `final_sketch_provided` -- only
// `style`, `scene_type`, and `final_sketch_url` are, so those three are
// what this derivation reads. `focal_points` is deliberately not a
// discriminator either: it's set within the same capture-wizard screen
// as the initial photo upload, too transient to surface as its own
// stage.
export const SKETCH_STATUS = {
  CAPTURED: 'Just captured',
  ANALYZING: 'Ready to sketch',
  SKETCHING: 'Sketching',
  DETAILS: 'Awaiting details',
  COMPLETE: 'Complete',
}

export function getSketchStatus(sketch) {
  if (sketch.final_sketch_url) {
    return sketch.title ? SKETCH_STATUS.COMPLETE : SKETCH_STATUS.DETAILS
  }
  if (sketch.scene_type) return SKETCH_STATUS.SKETCHING
  if (sketch.style) return SKETCH_STATUS.ANALYZING
  return SKETCH_STATUS.CAPTURED
}
