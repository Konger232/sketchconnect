import { useState } from 'react'
import Button from '../common/Button'
import ConfirmDialog from '../common/ConfirmDialog'
import FloatPanel from '../common/FloatPanel'
import Icon from '../common/Icon'
import { api } from '../../lib/api'
import { imageUrl } from '../../lib/media'

// The kit's categories, in page order (design handoff: "What {name}
// carries"). Keys are kit_items.kind (features/kit/router.py).
export const KIT_KINDS = [
  { kind: 'line', label: 'Pens' },
  { kind: 'ink', label: 'Ink' },
  { kind: 'color', label: 'Paint' },
  { kind: 'paper', label: 'Paper' },
  { kind: 'brush', label: 'Brushes' },
  { kind: 'extra', label: 'Extras' },
]

// A paint with a pigment code is a swatch row, edited with PaintEditor on
// the page. Every other tool is a name and a note, edited here.
export const isSwatchPaint = (item) => item.kind === 'color' && item.pigment_codes?.length > 0

let tempId = 0

/**
 * Edit kit (design handoff): replace the kit photo, then one row per tool:
 * category, name, note, remove; and "Add item". A modal FloatPanel. The
 * photo uploads straight away (POST /api/profile/kit-photo); the rows save
 * together on Save, through /api/kit. Reading the tools from the photo
 * (the kit reading call) comes later.
 */
export default function EditKitPanel({ items, kitPhotoUrl, onClose, onSaved }) {
  const start = items.filter((i) => !isSwatchPaint(i))
  const [rows, setRows] = useState(start.map((i) => ({ ...i, note: i.details?.note || '' })))
  const [photo, setPhoto] = useState(kitPhotoUrl)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const update = (id, key, value) => { setDirty(true); setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: value } : r))) }
  const remove = (id) => { setDirty(true); setRows((rs) => rs.filter((r) => r.id !== id)) }
  const add = () => { setDirty(true); setRows((rs) => [...rs, { id: `new-${++tempId}`, isNew: true, kind: 'line', label: '', note: '', details: {} }]) }

  async function replacePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('image', file)
      const { data } = await api.post('/api/profile/kit-photo', form)
      setPhoto(data.kit_photo_url)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not upload the photo.')
    } finally {
      setUploading(false)
    }
  }

  const body = (r) => ({
    kind: r.kind,
    label: r.label.trim(),
    details: { ...(r.details || {}), note: r.note.trim() },
    pigment_codes: r.kind === 'color' ? r.pigment_codes || [] : [],
    medium: r.kind === 'color' ? r.medium || null : null,
    opacity: r.kind === 'color' ? r.opacity || null : null,
    pinned: Boolean(r.pinned),
    hidden: Boolean(r.hidden),
  })

  async function save() {
    const blank = rows.find((r) => !r.label.trim())
    if (blank) return setError('Every tool needs a name.')
    setSaving(true)
    setError(null)
    try {
      const keep = new Set(rows.map((r) => r.id))
      const before = Object.fromEntries(start.map((i) => [i.id, i]))
      await Promise.all(start.filter((i) => !keep.has(i.id)).map((i) => api.delete(`/api/kit/${i.id}`)))
      for (const r of rows) {
        if (r.isNew) await api.post('/api/kit', body(r))
        else {
          const b = before[r.id]
          if (b.kind !== r.kind || b.label !== r.label || (b.details?.note || '') !== r.note) await api.put(`/api/kit/${r.id}`, body(r))
        }
      }
      onSaved?.(photo)
    } catch (err) {
      const d = err.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Could not save your kit.')
    } finally {
      setSaving(false)
    }
  }

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose(photo))

  return (
    <>
      <FloatPanel
        placement="modal"
        title="Edit kit"
        onClose={requestClose}
        footer={
          <>
            {error && <span className="mr-auto text-sm text-accent">{error}</span>}
            <Button variant="editorial" size="sm" onClick={requestClose}>Cancel</Button>
            <Button variant="action" onClick={save} disabled={saving || uploading}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <div className="flex items-center gap-4">
          <span className="photo-placeholder relative block h-20 w-16 shrink-0 overflow-hidden">
            {photo && <img src={imageUrl(photo)} alt="Your kit" className="absolute inset-0 h-full w-full object-cover" />}
          </span>
          <label className="cursor-pointer">
            <span className="inline-flex min-h-10 items-center border-[1.5px] border-ink px-3.5 text-sm font-bold text-ink">
              {uploading ? 'Uploading…' : photo ? 'Replace kit photo' : 'Add kit photo'}
            </span>
            <input type="file" accept="image/*" onChange={replacePhoto} disabled={uploading} className="hidden" />
          </label>
        </div>

        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-[1fr_auto] gap-2 border-b border-[var(--ed-row-rule)] py-2.5 md:grid-cols-[110px_1fr_1fr_auto] md:items-center">
              <select aria-label="Category" value={r.kind} onChange={(e) => update(r.id, 'kind', e.target.value)} className="field-input !px-2.5 max-md:col-span-1">
                {KIT_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <button type="button" aria-label="Remove" onClick={() => remove(r.id)} className="ed-icon-btn md:order-last">
                <Icon name="close" size={12} />
              </button>
              <input aria-label="Name" placeholder="Name" maxLength={80} value={r.label} onChange={(e) => update(r.id, 'label', e.target.value)}
                className="field-input max-md:col-span-2" />
              <input aria-label="Note" placeholder="Note" maxLength={80} value={r.note} onChange={(e) => update(r.id, 'note', e.target.value)}
                className="field-input italic max-md:col-span-2" />
            </li>
          ))}
        </ul>
        <button type="button" onClick={add} className="inline-flex min-h-9 items-center gap-1.5 self-start border border-dashed border-ink/60 px-3 text-sm font-bold">
          <Icon name="plus" size={14} /> Add item
        </button>
        <p className="text-xs text-ink/50">Paints with a swatch are changed in the Paint list on your page.</p>
      </FloatPanel>
      <ConfirmDialog
        open={confirmClose}
        title="Discard changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => { setConfirmClose(false); onClose(photo) }}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  )
}
