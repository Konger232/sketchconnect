import { api } from './api'

// Parallel run (design doc, item 20): the scene analysis response says which
// call drives the guided questions (guide_source, backend config.GUIDE_SOURCE).
// For "marks_analysis", the marks analysis call runs next and its questions
// replace the scene analysis ones. Everything else (overlays, focal areas,
// title) still comes from the scene analysis. If the marks analysis fails,
// the scene analysis questions stay, so the sketcher is never left without
// a guide.
export async function withGuideQuestions(sceneData, sketchId, signal) {
  if (sceneData?.guide_source !== 'marks_analysis') return sceneData
  try {
    const form = new FormData()
    form.append('sketch_id', sketchId)
    const { data } = await api.post('/api/marks-analysis', form, { signal })
    return {
      ...sceneData,
      prepared_prompts: data.prepared_prompts,
      marks_analysis: data,
      debug_raw_gemini_response: data.debug_raw_gemini_response || sceneData.debug_raw_gemini_response,
    }
  } catch (err) {
    if (signal?.aborted) throw err
    console.warn('Marks analysis failed; using the scene analysis questions', err)
    return sceneData
  }
}
