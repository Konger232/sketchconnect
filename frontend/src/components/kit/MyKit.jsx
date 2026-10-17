import { useEffect, useState } from 'react'
import Button from '../common/Button'
import { api } from '../../lib/api'

// My kit (design doc, item 28): the tools a sketcher carries, grouped by
// kind, typed in by hand. Lives in Settings. The kit photo and the kit
// reading call come later and add to the same list (GET/POST/PUT/DELETE
// /api/kit, features/kit/router.py, which also cleans every field).

const KINDS = [
  { kind: 'line', title: 'Pens and pencils', placeholder: 'Lamy Safari, fine nib' },
  { kind: 'color', title: 'Paints', placeholder: 'Daniel Smith Ultramarine' },
  { kind: 'brush', title: 'Brushes', placeholder: 'Pentel water brush' },
  { kind: 'paper', title: 'Paper', placeholder: 'Stillman & Birn Beta' },
  { kind: 'extra', title: 'Extras', placeholder: 'Folding stool' },
]

const SURFACES = [
  { value: 'cold_press', label: 'Cold press' },
  { value: 'hot_press', label: 'Hot press' },
  { value: 'rough', label: 'Rough' },
]

const EMPTY = { label: '', details: {}, codes: '', medium: '', opacity: '' }

// One line under a tool's name: its details, in plain words.
function summary(item) {
  const d = item.details || {}
  const parts = {
    line: [d.size, d.ink, d.waterproof && 'waterproof'],
    color: [item.pigment_codes?.join(', '), item.medium, item.opacity],
    brush: [d.size],
    paper: [d.size, d.weight, SURFACES.find((s) => s.value === d.surface)?.label.toLowerCase()],
    extra: [],
  }[item.kind]
  return parts.filter(Boolean).join(' · ')
}

export default function MyKit() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  // The form: { kind, id (when editing), ...fields }, or null when closed.
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(null)

  useEffect(() => {
    api.get('/api/kit')
      .then(({ data }) => setItems(data))
      .catch(() => setLoadError('Could not load your kit.'))
      .finally(() => setLoading(false))
  }, [])

  function openAdd(kind) {
    setFormError(null)
    setForm({ kind, ...EMPTY })
  }

  function openEdit(item) {
    setFormError(null)
    setForm({
      kind: item.kind,
      id: item.id,
      label: item.label,
      details: item.details || {},
      codes: (item.pigment_codes || []).join(', '),
      medium: item.medium || '',
      opacity: item.opacity || '',
    })
  }

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const setDetail = (key, value) => setForm((f) => ({ ...f, details: { ...f.details, [key]: value } }))

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    const body = {
      kind: form.kind,
      label: form.label,
      details: form.details,
      pigment_codes: form.codes.split(',').map((c) => c.trim()).filter(Boolean),
      medium: form.medium || null,
      opacity: form.opacity || null,
    }
    try {
      const { data } = form.id
        ? await api.put(`/api/kit/${form.id}`, body)
        : await api.post('/api/kit', body)
      setItems((list) => (form.id ? list.map((i) => (i.id === data.id ? data : i)) : [...list, data]))
      setForm(null)
    } catch (err) {
      const detail = err.response?.data?.detail
      setFormError(typeof detail === 'string' ? detail : 'Could not save this tool.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    try {
      await api.delete(`/api/kit/${id}`)
      setItems((list) => list.filter((i) => i.id !== id))
    } catch {
      setLoadError('Could not remove that tool.')
    } finally {
      setConfirmingDelete(null)
    }
  }

  const renderForm = (kindInfo) => (
    <form onSubmit={save} className="mt-2 flex flex-col gap-3 rounded-lg border border-ink/15 p-4">
      <label className="block text-sm">
        <span>Name</span>
        <input
          required
          maxLength={80}
          value={form.label}
          onChange={(e) => setField('label', e.target.value)}
          placeholder={kindInfo.placeholder}
          className="field-input mt-1.5"
        />
      </label>

      {form.kind === 'line' && (
        <>
          <label className="block text-sm">
            <span>Size or nib</span>
            <input value={form.details.size || ''} onChange={(e) => setDetail('size', e.target.value)} placeholder="0.3, F" className="field-input mt-1.5" />
          </label>
          <label className="block text-sm">
            <span>Ink</span>
            <input value={form.details.ink || ''} onChange={(e) => setDetail('ink', e.target.value)} placeholder="De Atramentis black" className="field-input mt-1.5" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(form.details.waterproof)} onChange={(e) => setDetail('waterproof', e.target.checked)} />
            Waterproof
          </label>
        </>
      )}

      {form.kind === 'color' && (
        <>
          <label className="block text-sm">
            <span>Pigment codes</span>
            <input value={form.codes} onChange={(e) => setField('codes', e.target.value)} placeholder="PB29" className="field-input mt-1.5" />
            <span className="mt-1 block text-xs text-ink/50">From the tube label. Separate more than one with commas, such as PB29, PBr7.</span>
          </label>
          <div className="flex gap-3">
            <label className="block flex-1 text-sm">
              <span>Medium</span>
              <select value={form.medium} onChange={(e) => setField('medium', e.target.value)} className="field-input mt-1.5">
                <option value="">Not set</option>
                <option value="watercolor">Watercolor</option>
                <option value="gouache">Gouache</option>
              </select>
            </label>
            <label className="block flex-1 text-sm">
              <span>Opacity</span>
              <select value={form.opacity} onChange={(e) => setField('opacity', e.target.value)} className="field-input mt-1.5">
                <option value="">Not set</option>
                <option value="transparent">Transparent</option>
                <option value="opaque">Opaque</option>
              </select>
            </label>
          </div>
        </>
      )}

      {form.kind === 'brush' && (
        <label className="block text-sm">
          <span>Size</span>
          <input value={form.details.size || ''} onChange={(e) => setDetail('size', e.target.value)} placeholder="Medium, round 8" className="field-input mt-1.5" />
        </label>
      )}

      {form.kind === 'paper' && (
        <>
          <div className="flex gap-3">
            <label className="block flex-1 text-sm">
              <span>Size</span>
              <input value={form.details.size || ''} onChange={(e) => setDetail('size', e.target.value)} placeholder="A5" className="field-input mt-1.5" />
            </label>
            <label className="block flex-1 text-sm">
              <span>Weight</span>
              <input value={form.details.weight || ''} onChange={(e) => setDetail('weight', e.target.value)} placeholder="300 gsm" className="field-input mt-1.5" />
            </label>
          </div>
          <label className="block text-sm">
            <span>Surface</span>
            <select value={form.details.surface || ''} onChange={(e) => setDetail('surface', e.target.value)} className="field-input mt-1.5">
              <option value="">Not set</option>
              {SURFACES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </>
      )}

      {formError && <p className="text-sm text-accent">{formError}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        <Button type="button" variant="outline" onClick={() => setForm(null)}>Cancel</Button>
      </div>
    </form>
  )

  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold">My kit</h2>
      <p className="mt-1 text-sm text-ink/60">
        The tools you carry. Tips can name them, and other sketchers can see what you work with.
      </p>

      {loading && <p className="mt-4 text-sm text-ink/50">Loading…</p>}
      {loadError && <p className="mt-4 text-sm text-accent">{loadError}</p>}

      {!loading && (
        <div className="mt-4 flex flex-col gap-6">
          {KINDS.map((k) => {
            const group = items.filter((i) => i.kind === k.kind)
            const formHere = form && form.kind === k.kind
            return (
              <div key={k.kind}>
                <h3 className="text-sm font-semibold">{k.title}</h3>
                <ul className="mt-1 divide-y divide-ink/10">
                  {group.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{item.label}</p>
                        {summary(item) && <p className="truncate text-xs text-ink/50">{summary(item)}</p>}
                      </div>
                      {confirmingDelete === item.id ? (
                        <>
                          <Button variant="link" className="text-accent" onClick={() => remove(item.id)}>Remove</Button>
                          <Button variant="link" onClick={() => setConfirmingDelete(null)}>Keep</Button>
                        </>
                      ) : (
                        <>
                          <Button variant="link" onClick={() => openEdit(item)}>Edit</Button>
                          <Button variant="link" onClick={() => setConfirmingDelete(item.id)}>Remove</Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {formHere ? renderForm(k) : (
                  <Button variant="link" className="mt-1 underline" onClick={() => openAdd(k.kind)}>
                    + Add {k.title.toLowerCase()}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
