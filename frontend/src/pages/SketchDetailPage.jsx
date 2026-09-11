import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import Button from '../components/common/Button'
import Tag from '../components/common/Tag'
import MascotIcon from '../components/common/MascotIcon'
import LocationMap from '../components/map/LocationMap'
import { sceneTypeLabel, STYLES } from '../data/styles'
import { api } from '../lib/api'

const styleLabel = (v) => STYLES.find((s) => s.value === v)?.label || v

// "Feedback Summary" detail — matches the Figma "My cactus" card: split
// before/after image, tags, critique text, Done for now / Keep sketching
// (the critique call supports multiple invocations per session).
//
// Public by design: this route has no RequireAuth (see App.jsx) -- any
// sketch can be opened by anyone, signed in or not, via a link from the
// Home feeds. The backend (`get_sketch` in sketches.py) tells us whether
// the current requester is this sketch's owner via `is_owner`, and never
// even sends critique/feedback text to non-owners in the first place --
// so everything owner-only below is gated on that one flag rather than
// on whether *someone* happens to be logged in.
export default function SketchDetailPage() {
  const { sketchId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const [sketch, setSketch] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [finalFile, setFinalFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  // "Delete" sits right next to "Edit" (same row), but the destructive
  // action itself only fires after this inline confirmation -- no
  // native window.confirm(), to match the rest of the app's own UI
  // rather than a browser-styled dialog.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const isOwner = sketch?.is_owner === true
  const wantsCritique = isOwner && params.get('critique') === '1'

  async function load() {
    try {
      const { data } = await api.get(`/api/sketches/${sketchId}`)
      setSketch(data)
    } catch (err) {
      setLoadError(err.response?.status === 404 ? 'not_found' : 'error')
    }
  }

  useEffect(() => { load() }, [sketchId])

  async function submitCritique() {
    setSubmitting(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('sketch_id', sketchId)
      form.append('style', sketch.style)
      form.append('scene_type', sketch.scene_type)
      form.append('session_choices', '[]')
      form.append('help_quest_log', '[]')
      const latest = sketch.critiques?.[sketch.critiques.length - 1]
      if (latest) form.append('prior_review_summary', latest.critique)
      if (finalFile) form.append('final_sketch', finalFile)
      await api.post('/api/critique', form)
      await load()
      navigate(`/sketches/${sketchId}`, { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not get feedback right now.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await api.delete(`/api/sketches/${sketchId}`)
      navigate('/profile')
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not delete this sketch.')
      setDeleting(false)
    }
  }

  if (loadError) {
    return (
      <div>
        <Header />
        <main className="mx-auto max-w-2xl px-4 pb-16 pt-8 text-center text-ink/60">
          {loadError === 'not_found' ? "This sketch doesn't exist (or was deleted)." : 'Could not load this sketch right now.'}
        </main>
      </div>
    )
  }

  if (!sketch) return <div className="p-8 text-center text-ink/50">Loading…</div>

  const latestCritique = isOwner ? sketch.critiques?.[sketch.critiques.length - 1] : null

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-2xl px-4 pb-16">
        <div className="mt-4 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="text-xl">←</button>
          {isOwner && (
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(`/sketches/${sketchId}/edit`)}
                className="text-sm font-medium text-ink/60 hover:text-ink"
              >
                Edit
              </button>
              <button
                onClick={() => setConfirmingDelete(true)}
                className="text-sm font-medium text-accent hover:text-accent/80"
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {isOwner && confirmingDelete && (
          <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
            <p className="text-sm">
              Delete this sketch? This removes its photo and any feedback, and can't be undone.
            </p>
            {error && <p className="mt-2 text-sm text-accent">{error}</p>}
            <div className="mt-3 flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                disabled={deleting}
                onClick={() => { setConfirmingDelete(false); setError(null) }}
              >
                Cancel
              </Button>
              <Button variant="danger" className="flex-1" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Deleting…' : 'Delete sketch'}
              </Button>
            </div>
          </div>
        )}

        <img src={
          sketch.reference_image_url?.startsWith('http')
            ? sketch.reference_image_url
            : `${api.defaults.baseURL}${sketch.reference_image_url}`
        } alt="" className="w-full rounded-xl object-cover" />

        <h1 className="mt-3 text-xl font-bold">{sketch.title || 'Untitled sketch'}</h1>
        <p className="text-xs text-ink/60">
          {sketch.captured_at && new Date(sketch.captured_at).toLocaleDateString()}
        </p>
        <div className="mt-2 flex gap-2">
          {sketch.style && <Tag>{styleLabel(sketch.style)}</Tag>}
          {sketch.scene_type && <Tag>{sceneTypeLabel[sketch.scene_type]}</Tag>}
        </div>

        {sketch.field_notes && (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink/80">{sketch.field_notes}</p>
        )}

        {sketch.location && (
          <div className="mt-4">
            <LocationMap lat={sketch.location.lat} lon={sketch.location.lon} label={sketch.title} />
          </div>
        )}

        {wantsCritique && (
          <div className="mt-6 rounded-xl border border-black/15 p-4">
            <p className="text-sm font-medium">Add your final sketch for feedback (optional)</p>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFinalFile(e.target.files[0])}
              className="mt-2"
            />
            {error && <p className="mt-2 text-sm text-accent">{error}</p>}
            <Button className="mt-3 w-full" disabled={submitting} onClick={submitCritique}>
              {submitting ? 'Getting feedback…' : 'Get feedback'}
            </Button>
          </div>
        )}

        {isOwner && !latestCritique && (
          <button
            onClick={() => navigate(`/sketch-flow/${sketchId}`)}
            aria-label={sketch.style ? 'Resume AI guidance' : 'Start AI guidance'}
            title={sketch.style ? 'Resume AI guidance' : 'Start AI guidance'}
            className="fixed bottom-24 left-4 z-[1100] flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-lg hover:bg-black"
          >
            <MascotIcon className="h-7 w-7" />
          </button>
        )}

        {isOwner && latestCritique && (
          <div className="mt-6">
            <div className="flex items-center gap-2">
              <MascotIcon className="h-5 w-5" />
              <h2 className="font-semibold">Feedback Summary</h2>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{latestCritique.critique}</p>

            <div className="mt-4 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => navigate('/profile')}>
                Done for now
              </Button>
              <Button className="flex-1" onClick={() => navigate(`/sketches/${sketchId}?critique=1`)}>
                Keep sketching
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
