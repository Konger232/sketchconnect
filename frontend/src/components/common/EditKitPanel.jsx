import { useEffect, useRef, useState } from 'react'
import BagPhotos from './BagPhotos'
import Button from './Button'
import ConfirmDialog from './ConfirmDialog'
import FloatPanel from './FloatPanel'
import Icon from './Icon'
import { api } from '../../lib/api'
import { useSheetDrag } from '../../lib/useSheetDrag'
import { useWide } from '../../lib/useWide'

// The fixed categories, in page order. Keys are kit_items.category
// (features/kit/router.py). Paints are My palette, not tools.
export const KIT_CATEGORIES = [
  { category: 'pen', label: 'Pens' },
  { category: 'ink', label: 'Ink' },
  { category: 'brush', label: 'Brushes' },
  { category: 'paper', label: 'Paper' },
  { category: 'sketchbook', label: 'Sketch books' },
  { category: 'palette', label: 'Palettes' },
  { category: 'clips', label: 'Clips' },
  { category: 'easel', label: 'Easels' },
  { category: 'bag', label: 'Bags' },
  { category: 'other', label: 'Other' },
]

const MAX_PHOTOS = 1 // one photo for the first release (features/kit/router.py MAX_KIT_PHOTOS)
const TIP_WORDS = 30 // features/kit/router.py MAX_NOTE_WORDS
const wordCount = (t) => (t || '').trim().split(/\s+/).filter(Boolean).length

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
  const [readFailed, setReadFailed] = useState(null) // the photo the AI could not read, to offer Try again
  const fileRef = useRef(null)
  const formRef = useRef(null)

  const draftKey = draft ? draft.id || `new-${draft.spot ? 'spot' : 'list'}` : null
  const wide = useWide()
  // On a phone the form is the draggable bottom sheet from Edit Sketch, in
  // white; opening it shows the photo above it.
  const [sheetOpen, setSheetOpen] = useState(true)
  const sheet = useSheetDrag(sheetOpen, setSheetOpen, '.kit-sheet-title')
  const photoRef = useRef(null)
  useEffect(() => {
    if (!draftKey) return
    setSheetOpen(true)
    if (!wide) photoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [draftKey, wide])

  const tools = items
  const fail = (err, fallback) => setError(typeof err?.response?.data?.detail === 'string' ? err.response.data.detail : fallback)

  async function readPhoto(index) {
    setBusy('Finding your gear on this photo…')
    setError(null)
    setReadFailed(null)
    setDraft(null)
    try {
      const { data } = await api.post('/api/kit/read', { photo: index })
      setItems(data.kit)
      setNote(data.found
        ? `Found ${data.found} ${data.found === 1 ? 'piece' : 'pieces'} of gear. Tap a pin to fix a name or add a tip; tap the photo to add one it missed.`
        : 'No gear found on this photo. Tap the photo to add it yourself.')
    } catch (err) {
      fail(err, 'Could not read the gear right now. Try again, or tap the photo to add it yourself.')
      setReadFailed(index)
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
    if (!draft.label.trim()) return setError('Every piece of gear needs a name.')
    setError(null)
    try {
      const { data } = draft.id
        ? await api.put(`/api/kit/${draft.id}`, body(draft))
        : await api.post('/api/kit', body(draft))
      setItems((list) => (draft.id ? list.map((i) => (i.id === data.id ? data : i)) : [...list, data]))
      setDraft(null)
    } catch (err) {
      fail(err, 'Could not save this gear.')
    }
  }

  async function removeTool(id) {
    try {
      await api.delete(`/api/kit/${id}`)
      setItems((list) => list.filter((i) => i.id !== id))
      setDraft(null)
    } catch (err) {
      fail(err, 'Could not remove this gear.')
    }
  }

  const editTool = (i) => { setNote(null); setDraft({ ...i, note: i.note || '', link: i.link || '' }) }
  const newTool = (spot = null) => { setNote(null); setDraft({ id: null, category: 'other', label: '', note: '', link: '', spot }) }

  // The form for one piece of gear. On a computer it sits over the photo,
  // on the half away from the pin, so the pin stays in view; on a phone it
  // is a bottom sheet.
  const form = draft && (
    <div ref={formRef} onClick={(e) => e.stopPropagation()}
      className={`flex flex-col gap-2 bg-white ${wide ? 'min-h-0 overflow-y-auto p-3 shadow-[0_0_16px_rgba(0,0,0,0.25)]' : 'px-4 pb-4'}`}>
      <span className={`ed-caption ${wide ? '' : 'kit-sheet-title py-1'}`}>{draft.id ? 'Edit gear' : draft.spot ? 'New gear here' : 'New gear'}</span>
      <div className="kit-fields contents">
      <div className="grid gap-2 md:grid-cols-[160px_1fr]">
        <select aria-label="Category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="field-select">
          {KIT_CATEGORIES.map((k) => <option key={k.category} value={k.category}>{k.label}</option>)}
        </select>
        <input aria-label="Name" placeholder="Name, e.g. Lamy Safari fountain pen" maxLength={80} value={draft.label} autoFocus
          onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="field-input" />
      </div>
      <textarea aria-label="Tip" rows={1} placeholder="A short tip, e.g. extra fine nib, waterproof ink" value={draft.note}
        onChange={(e) => setDraft({ ...draft, note: e.target.value })} className="field-input min-h-[42px] resize-y italic" />
      <input aria-label="Link" type="url" placeholder="Where to get it (optional link)" maxLength={300} value={draft.link}
        onChange={(e) => setDraft({ ...draft, link: e.target.value })} className="field-input" />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className={`mr-auto text-xs ${wordCount(draft.note) > TIP_WORDS ? 'text-accent' : 'text-ink/50'}`}>
          Tip: {wordCount(draft.note)} / {TIP_WORDS} words
        </span>
        {draft.id && <Button variant="editorial" size="sm" onClick={() => removeTool(draft.id)}>Remove</Button>}
        <Button variant="editorial" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
        <Button variant="editorialSolid" size="sm" onClick={saveDraft} disabled={wordCount(draft.note) > TIP_WORDS}>Save</Button>
      </div>
      </div>
    </div>
  )
  const sheetAt = draft?.spot && draft.spot.photo === active && draft.spot.y > 0.5 ? 'top' : 'bottom'

  return (    <>
      <FloatPanel
        placement="modal"
        title="Edit gear"
        width="800px"
        onClose={() => onClose()}
        footer={
          <>
            {error && <span className="mr-auto text-sm text-accent">{error}</span>}
            <Button variant="action" onClick={() => onClose()} disabled={Boolean(busy)}>Done</Button>
          </>
        }
      >
        <p className="m-0 text-sm text-ink/70">
          Upload a photo of your sketch bag or your usual sketching gear to share with the community. Lay it out flat if you can. The AI finds each piece and pins it; tap a pin to fix it. {MAX_PHOTOS > 1 ? `Up to ${MAX_PHOTOS} photos. ` : ''}Changes save as you go.
        </p>

        {photos.length > 0 ? (
          // Stays in view while the list scrolls under it (computer).
          <div ref={photoRef} className="z-10 scroll-mt-2 bg-white md:sticky md:-top-5 md:-mx-6 md:px-6 md:py-2">
            <BagPhotos photos={photos} items={items} active={active} onActive={(k) => { setActive(k); setDraft(null) }}
              editing selectedId={draft?.id} onEdit={editTool} onRemove={(i) => removeTool(i.id)} onSpot={(spot) => newTool(spot)} busy={busy} alt="Your bag"
              fitHeight={wide ? '58vh' : null} sheet={wide ? form : null} sheetAt={sheetAt} />
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}
            className="flex min-h-[180px] flex-col items-center justify-center gap-2 border-[1.5px] border-dashed border-ink/30 p-6 text-center hover:border-ink">
            <Icon name="camera" size={22} />
            <span className="text-sm font-semibold">{busy || 'Add photo'}</span>
            <span className="text-xs text-ink/60">Lay the tools out, light from the side, no faces needed.</span>
          </button>
        )}

        {/* The AI reads a photo once, when it is added. Try again shows
            only when that read failed; a second read would replace the
            pins the sketcher has already fixed. */}
        <div className="flex flex-wrap items-center gap-2">
          {photos.length > 0 && photos.length < MAX_PHOTOS && (
            <Button variant="editorial" size="sm" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={14} /> Add photo
            </Button>
          )}
          {readFailed === active && photos.length > 0 && (
            <Button variant="editorial" size="sm" disabled={Boolean(busy)} onClick={() => readPhoto(active)}>Try again</Button>
          )}
          {photos.length > 0 && (
            <Button variant="editorial" size="sm" disabled={Boolean(busy)} onClick={() => setRemovingPhoto(active)}>Remove this photo</Button>
          )}
          <Button variant="editorial" size="sm" className="ml-auto" disabled={Boolean(busy)} onClick={() => newTool(null)}>
            <Icon name="plus" size={14} /> Add gear
          </Button>
          <input ref={fileRef} type="file" accept="image/*" onChange={addPhoto} className="hidden" />
        </div>
        {note && <p className="m-0 text-sm text-ink/80">{note}</p>}

        {/* On a phone the form is a white bottom sheet: drag the handle
            to resize it, tap it to fold the form down to its title. */}
        {draft && !wide && (
          <div ref={sheet.ref} className={`sc-sheet flex flex-col bg-white max-md:!z-[1600] ${sheet.className} ${sheetOpen ? '' : '[&_.kit-fields]:hidden'}`} style={sheet.style}>
            <button type="button" className="sc-sheet-handle touch-none" {...sheet.handleProps}
              aria-label={sheetOpen ? 'Fold the form down' : 'Open the form'} aria-expanded={sheetOpen}>
              <span />
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto">{form}</div>
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
                {i.spot && i.spot.photo < photos.length && (
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
        <p className="m-0 text-xs text-ink/50">Your paints go in My palette on your page.</p>
      </FloatPanel>
      <ConfirmDialog
        open={removingPhoto !== null}
        title="Remove this photo?"
        message="Its gear stays in your bag, without the pins."
        confirmLabel="Remove"
        cancelLabel="Keep it"
        onConfirm={() => removePhoto(removingPhoto)}
        onCancel={() => setRemovingPhoto(null)}
      />
    </>
  )
}
