import { api } from './api'

// Two calls (scene-photo-only branch, October 6, 2026):
//  1. Scene analysis reads the framed photo only: scene type, summary,
//     title and focal areas. New Sketch starts it as soon as the crop is
//     confirmed (startSceneAnalysis), so it runs while the sketcher draws.
//  2. Marks analysis reads the marks and writes every guided question.
// The backend caches both: scene analysis per photo and framing, marks
// analysis per marks and selection.

function sceneForm(sketchId) {
  const form = new FormData()
  form.append('sketch_id', sketchId)
  return form
}

// Starts the scene analysis and returns its promise. A failure is caught
// here and retried by runGuideAnalysis, so it never surfaces as an
// unhandled rejection while the sketcher is still drawing.
export function startSceneAnalysis(sketchId, signal) {
  return api
    .post('/api/scene-analysis', sceneForm(sketchId), { signal })
    .then(({ data }) => data)
    .catch(() => null)
}

// The guide: waits for the scene analysis started earlier (if any), then
// asks once more, which is a quick cache hit unless the framing changed or
// the early call failed, then runs the marks analysis.
export async function runGuideAnalysis(sketchId, { scene = null, signal } = {}) {
  if (scene) await scene
  const { data: sceneData } = await api.post('/api/scene-analysis', sceneForm(sketchId), { signal })
  const { data } = await api.post('/api/marks-analysis', sceneForm(sketchId), { signal })
  return {
    ...sceneData,
    prepared_prompts: data.prepared_prompts,
    focal_suggestions: data.focal_suggestions,
    marks_analysis: data,
    debug_raw_gemini_response: data.debug_raw_gemini_response || sceneData.debug_raw_gemini_response,
  }
}
