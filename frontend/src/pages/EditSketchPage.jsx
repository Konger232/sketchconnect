import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import Button from '../components/common/Button'
import LocationPicker from '../components/map/LocationPicker'
import { api } from '../lib/api'

// Editing a saved sketch: title, field notes, and location (click/drag on
// the map -- see LocationMap.jsx's `editable` mode). Location starts out
// pre-filled from whatever GPS the reference photo's EXIF carried (set at
// upload time in sketches.py's create_sketch); this page lets the sketcher
// add or correct it when the photo had none, or when it's simply wrong.
export default function EditSketchPage() {
  const { sketchId } = useParams()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [fieldNotes, setFieldNotes] = useState('')
  const [location, setLocation] = useState(null) // { lat, lon } | null
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get(`/api/sketches/${sketchId}`)
      .then(({ data }) => {
        setTitle(data.title || '')
        setFieldNotes(data.field_notes || '')
        setLocation(data.location || null)
      })
      .catch(() => setError('Could not load this sketch.'))
      .finally(() => setLoading(false))
  }, [sketchId])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await api.put(`/api/sketches/${sketchId}`, {
        title,
        field_notes: fieldNotes,
        location: location || undefined,
      })
      navigate(`/sketches/${sketchId}`)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save these changes.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-center text-ink/50">Loading…</div>

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-2xl px-4 pb-16">
        <h1 className="mt-4 text-xl font-bold">Edit Sketch</h1>

        <div className="mt-6 flex flex-col gap-4">
          <label className="block">
            <span className="text-sm font-medium">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/15 px-4 py-3"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Field Notes</span>
            <input
              value={fieldNotes}
              onChange={(e) => setFieldNotes(e.target.value)}
              placeholder="Optional — add this later if you like"
              className="mt-1 w-full rounded-lg border border-black/15 px-4 py-3"
            />
          </label>

          <div>
            <span className="text-sm font-medium">Location</span>
            <div className="mt-1">
              <LocationPicker location={location} onLocationChange={setLocation} />
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-accent">{error}</p>}

        <Button className="mt-6 w-full" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </main>
    </div>
  )
}
