import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { notifySketchesChanged } from '../../lib/sketchEvents'

/**
 * A sketch's Details (title, field note, location, who can see it, Glaze,
 * the event link) and their autosave. Shared by Edit Sketch and Capture
 * (design doc, item 57). SketchDetailsForm draws them.
 *
 * sketch: the loaded sketch, or null; setSketch merges the saved fields
 * back. enabled: only the owner edits.
 */
export function useSketchDetails({ sketchId, sketch, setSketch, enabled }) {
  const [title, setTitle] = useState('')
  const [fieldNotes, setFieldNotes] = useState('')
  const [recordRequest, setRecordRequest] = useState(0) // the mic on the Field note label: start a recording
  const [visibility, setVisibility] = useState('members') // who sees it once shared
  const [glazed, setGlazed] = useState(false)
  const [location, setLocation] = useState(null)
  const [editingLocation, setEditingLocation] = useState(false)
  // The sketch's event (item 49): the events it can be linked to now (the
  // ones I'm Interested in, not ended more than 14 days ago), and any error
  // from linking. The link saves at once, not with the autosave.
  const [linkable, setLinkable] = useState([])
  const [eventError, setEventError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedJustNow, setSavedJustNow] = useState(false)

  function seed(from) {
    setTitle(from.title || '')
    setFieldNotes(from.field_notes || '')
    setVisibility(from.visibility || 'members')
    setGlazed(Boolean(from.glazed))
    setLocation(from.location || null)
    setEditingLocation(!from.location)
  }

  useEffect(() => {
    if (sketch) seed(sketch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch?.id])

  // The place name is filled in after the upload (backend, November 26,
  // 2026). When it arrives for the same spot, take it: it is not an edit.
  useEffect(() => {
    const got = sketch?.location
    if (got?.label && location && !location.label && got.lat === location.lat && got.lon === location.lon) setLocation(got)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch?.location?.label])

  useEffect(() => {
    if (!sketch?.id) return
    const loc = sketch.location
    api.get('/api/events/linkable', { params: loc ? { lat: loc.lat, lon: loc.lon } : {} })
      .then(({ data }) => setLinkable(data)).catch(() => setLinkable([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch?.id])

  async function changeEvent(eventId) {
    setEventError(null)
    try {
      const { data } = await api.put(`/api/sketches/${sketchId}`, { event_id: eventId })
      setSketch((prev) => ({ ...prev, event_id: data.event_id, event: data.event }))
      notifySketchesChanged()
    } catch (err) {
      setEventError(err.response?.data?.detail || 'Could not change the event.')
    }
  }

  // Unsaved Details (title, field notes, location).
  function dirty() {
    if (!sketch) return false
    return (
      title !== (sketch.title || '') ||
      fieldNotes !== (sketch.field_notes || '') ||
      visibility !== (sketch.visibility || 'members') ||
      glazed !== Boolean(sketch.glazed) ||
      JSON.stringify(location) !== JSON.stringify(sketch.location || null)
    )
  }

  // Returns whether it saved.
  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const { data } = await api.put(`/api/sketches/${sketchId}`, {
        title,
        field_notes: fieldNotes,
        visibility,
        glazed,
        // Always sent, even as null, so clearing the location clears it.
        location,
      })
      setSketch((prev) => ({ ...prev, ...data }))
      setSavedJustNow(true)
      setTimeout(() => setSavedJustNow(false), 2000)
      return true
    } catch (err) {
      setSaveError(err.response?.data?.detail || 'Could not save these changes.')
      return false
    } finally {
      setSaving(false)
    }
  }

  // Autosave: a moment after typing stops, like the Value and Color tabs
  // save as they change.
  const timer = useRef(null)
  useEffect(() => {
    if (!sketch || !enabled || !dirty()) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { save() }, 1000)
    return () => clearTimeout(timer.current)
  }, [title, fieldNotes, location, visibility, glazed]) // eslint-disable-line react-hooks/exhaustive-deps

  // A change still waiting is saved now (closing, Save). Returns whether
  // everything is saved.
  async function flush() {
    clearTimeout(timer.current)
    return dirty() ? save() : true
  }

  return {
    title, setTitle, fieldNotes, setFieldNotes, recordRequest, setRecordRequest,
    visibility, setVisibility, glazed, setGlazed, location, setLocation,
    editingLocation, setEditingLocation, linkable, eventError, changeEvent,
    saving, saveError, savedJustNow, dirty, save, flush,
  }
}
