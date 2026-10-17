import { useState } from 'react'
import Button from '../common/Button'
import FloatPanel from '../common/FloatPanel'
import Icon from '../common/Icon'
import { api } from '../../lib/api'

const MAX_ADMIRED = 5

/**
 * The sketcher's admired sketchers (design doc, item 36), only on their own
 * page. Adding a name sets up that voice for feedback once (the persona
 * creation call), so it takes a few seconds. Link and location can change
 * later; a new name means remove and add.
 */
export default function AdmiredPanel({ list, onClose, onChange }) {
  const [rows, setRows] = useState(list)
  const [draft, setDraft] = useState({ name: '', link: '', location: '' })
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const fail = (err, fallback) => {
    const d = err.response?.data?.detail
    setError(typeof d === 'string' ? d : fallback)
  }

  async function add(e) {
    e.preventDefault()
    if (!draft.name.trim()) return
    setBusy('add')
    setError(null)
    try {
      const { data } = await api.post('/api/admired', draft)
      const next = [...rows, data]
      setRows(next)
      onChange?.(next)
      setDraft({ name: '', link: '', location: '' })
    } catch (err) {
      fail(err, 'Could not add that sketcher.')
    } finally {
      setBusy(null)
    }
  }

  async function saveRow(r) {
    setBusy(r.id)
    setError(null)
    try {
      const { data } = await api.patch(`/api/admired/${r.id}`, { link: r.link || '', location: r.location || '' })
      const next = rows.map((x) => (x.id === r.id ? data : x))
      setRows(next)
      onChange?.(next)
    } catch (err) {
      fail(err, 'Could not save that change.')
    } finally {
      setBusy(null)
    }
  }

  async function remove(id) {
    setBusy(id)
    setError(null)
    try {
      await api.delete(`/api/admired/${id}`)
      const next = rows.filter((x) => x.id !== id)
      setRows(next)
      onChange?.(next)
    } catch (err) {
      fail(err, 'Could not remove that sketcher.')
    } finally {
      setBusy(null)
    }
  }

  const edit = (id, key, value) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: value, dirty: true } : r)))

  return (
    <FloatPanel placement="modal" title="Admired sketchers" onClose={onClose}
      footer={<Button variant="editorialSolid" size="sm" onClick={onClose}>Done</Button>}>
      <p className="text-sm text-ink/70">
        Only you see this list. When you upload a final sketch, you can pick one of them as the voice for your feedback.
      </p>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 border-b border-[var(--ed-row-rule)] py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-md font-semibold">{r.name}</span>
              <button type="button" className="ed-icon-btn" aria-label={`Remove ${r.name}`} onClick={() => remove(r.id)} disabled={busy === r.id}>
                <Icon name="delete" size={16} />
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <input className="field-input" placeholder="Link (Instagram, Facebook or website)" value={r.link || ''} onChange={(e) => edit(r.id, 'link', e.target.value)} />
              <input className="field-input" placeholder="Where they sketch" value={r.location || ''} onChange={(e) => edit(r.id, 'location', e.target.value)} />
            </div>
            {r.dirty && (
              <Button variant="editorial" size="sm" className="self-start" onClick={() => saveRow(r)} disabled={busy === r.id}>
                {busy === r.id ? 'Saving…' : 'Save'}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {rows.length < MAX_ADMIRED ? (
        <form onSubmit={add} className="flex flex-col gap-2">
          <span className="ed-caption">Add a sketcher</span>
          <input className="field-input" placeholder="Name, such as Liz Steel" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <div className="grid gap-2 md:grid-cols-2">
            <input className="field-input" placeholder="Link (optional)" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} />
            <input className="field-input" placeholder="Where they sketch (optional)" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
          </div>
          <Button type="submit" variant="editorialSolid" size="sm" className="self-start" disabled={busy === 'add' || !draft.name.trim()}>
            {busy === 'add' ? 'Setting up their voice…' : 'Add'}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-ink/60">Your list holds {MAX_ADMIRED} sketchers. Remove one to add another.</p>
      )}
      {error && <p className="text-sm text-accent">{error}</p>}
    </FloatPanel>
  )
}
