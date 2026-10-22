import { useRef, useState } from 'react'
import BagPhotos from './BagPhotos'
import Button from './Button'
import ConfirmDialog from './ConfirmDialog'
import FloatPanel from './FloatPanel'
import Icon from './Icon'
import { api } from '../../lib/api'

// The fixed categories, in page order. Keys are kit_items.category
// (features/kit/router.py). Paints are My palette, not tools.
export const KIT_CATEGORIES = [
  { category: 'pen', label: 'Pens' },
  { category: 'ink', label: 'Ink' },
  { category: 'brush', label: 'Brushes' },
  { category: 'paper', label: 'Paper' },
  { category: 'sketchbook', label: 'Sketchbooks' },
  { category: 'palette', label: 'Palettes' },
  { category: 'clips', label: 'Clips' },
  { category: 'easel', label: 'Easels' },
  { category: 'bag', label: 'Bags' },
  { category: 'other', label: 'Other' },
]

const MAX_PHOTOS = 3
const TIP_CHARS = 40

// The body PUT and POST /api/kit expect.
const body = (r) => ({
  category: r.category,
  label: r.label.trim(),
  note: (r.note || '').trim() || null,
  link: (r.link || '').trim() || null,
  spot: r.spot || null,
})

/**
 * Edit my bag (design doc, item 44): snap and auto-tag. Add up to 3 photos
 * of your bag or a flat lay; the AI finds the tools and pins each one on
 * the photo. Tap a pin to fix its name, change its category, add a short
 * tip or a link;
 * tap the photo to add a tool it missed. Every change saves at once.
 */
export default function EditKitPanel({ items: startItems, photos: startPhotos, onClose }) {
  const [items, setItems] = useState(startItems)
  const [photos, setPhotos] = useState(startPhotos || [])
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(null) // a line over the photo while the AI reads it
  const [note, setNote] = useState(null) // what just happened
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(null) // the tool being edited: { id?, kind, label, note, spot }
  const [removingPhoto, setRemovingPhoto] = useState(null)
  const fileRef = useRef(null)

  const tools = items
  const fail = (err, fallback) => setError(typeof err?.response?.data?.detail === 'string' ? err.response.data.detail : fallback)

  async function readPhoto(index) {
    setBusy('Finding your tools…')
    setError(null)
    setDraft(null)
    try {
      const { data } = await api.post('/api/kit/read', { photo: index })
      setItems(data.kit)
      setNote(data.found
        ? `Found ${data.found} ${data.found === 1 ? 'tool' : 'tools'}. Tap a pin to fix a name or add a tip; tap the photo to add one it missed.`
        : 'No tools found on this photo. Tap the photo to add them yourself.')
    } catch (err) {
      fail(err, 'Could not read the tools right now. Tap the photo to add them yourself.')
    } finally {
      setBusy(null)
    }
  }

  async function addPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy('Uploading…')
    setError(null)
    try {
      const form = new FormData()
      form.append('image', file)
      const { data } = await api.post('/api/profile/kit-photos', form)
      setPhotos(data.kit_photos)
      setActive(data.index)
      await readPhoto(data.index)
    } catch (err) {
      fail(err, 'Could not upload the photo.')
      setBusy(null)
    }
  }

  async function removePhoto(index) {
    setRemovingPhoto(null)
    try {
      const { data } = await api.delete(`/api/profile/kit-photos/${index}`)
      setPhotos(data.kit_photos)
      setActive(0)
      setDraft(null)
      const kit = await api.get('/api/kit')
      setItems(kit.data)
    } catch (err) {
      fail(err, 'Could not remove the photo.')
    }
  }

  async function saveDraft() {
    if (!draft.label.trim()) return setError('Every tool needs a name.')
    setError(null)
    try {
      const { data } = draft.id
        ? await api.put(`/api/kit/${draft.id}`, body(draft))
        : await api.post('/api/kit', body(draft))
      setItems((list) => (draft.id ? list.map((i) => (i.id === data.id ? data : i)) : [...list, data]))
      setDraft(null)
    } catch (err) {
      fail(err, 'Could not save this tool.')
    }
  }

  async function removeTool(id) {
    try {
      await api.delete(`/api/kit/${id}`)
      setItems((list) => list.filter((i) => i.id !== id))
      setDraft(null)
    } catch (err) {
      fail(err, 'Could not remove this tool.')
    }
  }

  const editTool = (i) => { setNote(null); setDraft({ ...i, note: i.note || '', link: i.link || '' }) }
  const newTool = (spot = null) => { setNote(null); setDraft({ id: null, category: 'other', label: '', note: '', link: '', spot }) }

  return (
    <>
      <FloatPanel
        placement="modal"
        title="Edit my bag"
        onClose={() => onClose()}
        footer={
          <>
            {error && <span className="mr-auto text-sm text-accent">{error}</span>}
            <Button variant="action" onClick={() => onClose()} disabled={Boolean(busy)}>Done</Button>
          </>
        }
      >
        <p className="m-0 text-sm text-ink/70">
          Snap your bag or lay your tools out flat. The AI finds them and pins each one; you fix what it got wrong. Up to {MAX_PHOTOS} photos. Changes save as you go.
        </p>

        {photos.length > 0 ? (
          <BagPhotos photos={photos} items={items} active={active} onActive={(k) => { setActive(k); setDraft(null) }}
            editing selectedId={draft?.id} onPin={editTool} onSpot={(spot) => newTool(spot)} busy={busy} alt="Your bag" />
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}
            className="flex min-h-[180px] flex-col items-center justify-center gap-2 border-[1.5px] border-dashed border-ink/30 p-6 text-center hover:border-ink">
            <Icon name="camera" size={22} />
            <span className="text-sm font-semibold">{busy || 'Add a photo of your bag'}</span>
            <span className="text-xs text-ink/60">Lay the tools out, light from the side, no faces needed.</span>
          </button>
        )}

        <div className="flex flex-wrap gap-2">
          {photos.length > 0 && photos.length < MAX_PHOTOS && (
            <Button variant="editorial" size="sm" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={14} /> Add another photo
            </Button>
          )}
          {photos.length > 0 && (
            <>
              <Button variant="editorial" size="sm" disabled={Boolean(busy)} onClick={() => readPhoto(active)}>Find tools again</Button>
              <Button variant="editorial" size="sm" disabled={Boolean(busy)} onClick={() => setRemovingPhoto(active)}>Remove this photo</Button>
            </>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={addPhoto} className="hidden" />
        </div>
        {note && <p className="m-0 text-sm text-ink/80">{note}</p>}

        {/* The tool being edited: a pin, a new spot, or a row below. */}
        {draft && (
          <div className="flex flex-col gap-2 border-[1.5px] border-ink p-3">
            <span className="ed-caption">{draft.id ? 'Edit tool' : draft.spot ? 'New tool here' : 'New tool'}</span>
            <div className="grid gap-2 md:grid-cols-[120px_1fr]">
              <select aria-label="Category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="field-input !px-2.5">
                {KIT_CATEGORIES.map((k) => <option key={k.category} value={k.category}>{k.label}</option>)}
              </select>
              <input aria-label="Name" placeholder="Name, e.g. Lamy Safari fountain pen" maxLength={80} value={draft.label} autoFocus
                onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="field-input" />
            </div>
            <input aria-label="Tip" placeholder="A short tip, e.g. extra fine nib, waterproof ink" maxLength={TIP_CHARS} value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })} className="field-input italic" />
            <input aria-label="Link" type="url" placeholder="Where to get it (optional link)" maxLength={300} value={draft.link}
              onChange={(e) => setDraft({ ...draft, link: e.target.value })} className="field-input" />
            <div className="flex flex-wrap gap-2">
              <Button variant="editorialSolid" size="sm" onClick={saveDraft}>Save</Button>
              {draft.id && <Button variant="editorial" size="sm" onClick={() => removeTool(draft.id)}>Remove</Button>}
              <Button variant="editorial" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </div>
        )}

        <ul className="m-0 flex list-none flex-col p-0">
          {tools.map((i) => {
            const pinIndex = items.filter((x) => x.spot && x.spot.photo === i.spot?.photo).indexOf(i)
            return (
              <li key={i.id} className="flex items-center gap-3 border-b border-[var(--ed-row-rule)] py-2">
                <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-ink/60">
                  {KIT_CATEGORIES.find((k) => k.category === i.category)?.label}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{i.label}</span>
                  {i.note && <span className="ed-note truncate">{i.note}</span>}
                </span>
                {i.spot && (
                  <span className="shrink-0 text-xs text-ink/50">{photos.length > 1 ? `Photo ${i.spot.photo + 1} · ` : ''}#{pinIndex + 1}</span>
                )}
                <button type="button" className="ed-icon-btn" aria-label={`Edit ${i.label}`} onClick={() => { if (i.spot) setActive(i.spot.photo); editTool(i) }}>
                  <Icon name="edit" size={14} />
                </button>
                <button type="button" className="ed-icon-btn" aria-label={`Remove ${i.label}`} onClick={() => removeTool(i.id)}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            )
          })}
        </ul>
        <button type="button" onClick={() => newTool(null)} className="inline-flex min-h-9 items-center gap-1.5 self-start border border-dashed border-ink/60 px-3 text-sm font-bold">
          <Icon name="plus" size={14} /> Add a tool by hand
        </button>
        <p className="m-0 text-xs text-ink/50">Your paints go in My palette on your page.</p>
      </FloatPanel>
      <ConfirmDialog
        open={removingPhoto !== null}
        title="Remove this photo?"
        message="Its tools stay in your bag, without their pins."
        confirmLabel="Remove"
        cancelLabel="Keep it"
        onConfirm={() => removePhoto(removingPhoto)}
        onCancel={() => setRemovingPhoto(null)}
      />
    </>
  )
}
