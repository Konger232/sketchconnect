import { useState } from 'react'
import { imageUrl } from '../../lib/media'

/**
 * What's in my bag (design doc, item 44): the bag photos, up to 3, with a
 * pin on each tool. Used on the Sketcher profile (view) and in Edit my bag
 * (edit).
 *
 *   photos      ["/uploads/..."]  (signed links in practice)
 *   items       the kit; a tool with spot {photo, x, y} gets a pin
 *   active, onActive(index)   the photo shown
 *   editing     tap a pin to edit it, tap the photo to add a tool there
 *   selectedId  the pin being edited
 *   onPin(item), onSpot({ photo, x, y })
 *   busy        a line over the photo ("Finding your tools…")
 */
export default function BagPhotos({ photos, items, active = 0, onActive, editing = false, selectedId, onPin, onSpot, busy, alt = 'A bag of sketching tools' }) {
  const [shown, setShown] = useState(null) // view mode: the pin whose name is showing
  const photo = photos[active]
  const pins = items.filter((i) => i.spot && i.spot.photo === active)

  function tapPhoto(e) {
    if (!editing || !onSpot) return setShown(null)
    const r = e.currentTarget.getBoundingClientRect()
    onSpot({ photo: active, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })
  }

  if (!photo) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full overflow-hidden bg-ink/5">
        <img src={imageUrl(photo)} alt={alt} onClick={tapPhoto} className={`block h-auto w-full ${editing ? 'cursor-crosshair' : ''}`} />
        {pins.map((i, n) => {
          const on = selectedId === i.id || shown === i.id
          return (
            <button key={i.id} type="button" aria-label={i.label}
              onClick={(e) => { e.stopPropagation(); if (editing) onPin?.(i); else setShown(shown === i.id ? null : i.id) }}
              className={`absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-bold shadow-[0_1px_4px_rgba(0,0,0,0.45)] ${
                on ? 'z-10 border-white bg-[var(--pin-active)] text-white' : 'border-white bg-ink/80 text-white'
              }`}
              style={{ left: `${i.spot.x * 100}%`, top: `${i.spot.y * 100}%` }}>
              {n + 1}
              {!editing && shown === i.id && (
                <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 w-max max-w-[220px] -translate-x-1/2 rounded-md bg-white px-2.5 py-1.5 text-left text-xs font-normal text-ink shadow-lg">
                  <span className="block font-semibold">{i.label}</span>
                  {i.note && <span className="block text-ink/70">{i.note}</span>}
                </span>
              )}
            </button>
          )
        })}
        {busy && (
          <span className="absolute inset-x-0 bottom-0 animate-pulse bg-black/60 px-3 py-2 text-sm text-white">{busy}</span>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2">
          {photos.map((p, k) => (
            <button key={p} type="button" onClick={() => onActive?.(k)} aria-label={`Bag photo ${k + 1}`} aria-pressed={k === active}
              className={`h-14 w-14 overflow-hidden border-2 ${k === active ? 'border-ink' : 'border-transparent opacity-70'}`}>
              <img src={imageUrl(p)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
