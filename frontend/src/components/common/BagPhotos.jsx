import { useState } from 'react'
import { imageUrl } from '../../lib/media'

/**
 * What's in my bag (design doc, item 44): the bag photos, up to 3, with a
 * numbered pin on each piece of gear. Hover a pin (or tap it on a phone)
 * and a card unfolds on the photo: its name and tip, and, when editing,
 * Edit and Remove. Used on the Sketcher profile and in Edit gear.
 *
 *   photos      ["/uploads/..."]  (signed links in practice)
 *   items       the bag; gear with spot {photo, x, y} gets a pin
 *   active, onActive(index)   the photo shown
 *   editing     the card has Edit and Remove; tap the photo to add gear
 *   selectedId  the pin being edited
 *   onEdit(item), onRemove(item), onSpot({ photo, x, y })
 *   busy        a line over the photo ("Finding your gear…")
 */
export default function BagPhotos({ photos, items, active = 0, onActive, editing = false, selectedId, onEdit, onRemove, onSpot, busy, alt = 'A bag of sketching gear' }) {
  const [open, setOpen] = useState(null) // the pin whose card is open (tap)
  const photo = photos[active]
  const pins = items.filter((i) => i.spot && i.spot.photo === active)

  function tapPhoto(e) {
    if (open) return setOpen(null)
    if (!editing || !onSpot) return
    const r = e.currentTarget.getBoundingClientRect()
    onSpot({ photo: active, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })
  }

  if (!photo) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full">
        <img src={imageUrl(photo)} alt={alt} onClick={tapPhoto} className={`block h-auto w-full ${editing ? 'cursor-crosshair' : ''}`} />
        {pins.map((i, n) => {
          const on = selectedId === i.id || open === i.id
          const below = i.spot.y < 0.6 // the card unfolds below a pin in the top part, above one lower down
          const right = i.spot.x > 0.6
          return (
            // The pin and its card share a hover area, so the card stays
            // open while the pointer moves onto it.
            <span key={i.id} className="group absolute z-[1] -translate-x-1/2 -translate-y-1/2 hover:z-20"
              style={{ left: `${i.spot.x * 100}%`, top: `${i.spot.y * 100}%`, zIndex: open === i.id ? 20 : undefined }}>
              <button type="button" aria-label={i.label} aria-expanded={open === i.id}
                onClick={(e) => { e.stopPropagation(); setOpen(open === i.id ? null : i.id) }}
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold shadow-[0_1px_4px_rgba(0,0,0,0.45)] ${
                  on ? 'border-white bg-[var(--pin-active)] text-white' : 'border-white bg-ink/80 text-white group-hover:bg-[var(--pin-active)]'
                }`}>
                {n + 1}
              </button>
              <span onClick={(e) => e.stopPropagation()}
                className={`absolute w-max max-w-[240px] ${below ? 'top-full pt-1.5' : 'bottom-full pb-1.5'} ${right ? 'right-0' : 'left-0'} ${
                  open === i.id ? 'block' : 'hidden group-hover:block'
                }`}>
                <span className="flex flex-col gap-1.5 rounded-md bg-white px-3 py-2 text-left text-xs text-ink shadow-lg">
                  <span className="font-semibold">{i.label}</span>
                  {i.note && <span className="text-ink/70">{i.note}</span>}
                  {!editing && i.link && (
                    <a href={i.link} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Where to buy ↗</a>
                  )}
                  {editing && (
                    <span className="flex gap-3 pt-0.5">
                      <button type="button" className="font-semibold underline" onClick={() => { setOpen(null); onEdit?.(i) }}>Edit</button>
                      <button type="button" className="font-semibold text-accent underline" onClick={() => { setOpen(null); onRemove?.(i) }}>Remove</button>
                    </span>
                  )}
                </span>
              </span>
            </span>
          )
        })}
        {busy && (
          <span className="absolute inset-x-0 bottom-0 animate-pulse bg-black/60 px-3 py-2 text-sm text-white">{busy}</span>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2">
          {photos.map((p, k) => (
            <button key={p} type="button" onClick={() => { setOpen(null); onActive?.(k) }} aria-label={`Bag photo ${k + 1}`} aria-pressed={k === active}
              className={`h-14 w-14 overflow-hidden border-2 ${k === active ? 'border-ink' : 'border-transparent opacity-70'}`}>
              <img src={imageUrl(p)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
