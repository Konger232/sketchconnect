import { useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import SketchCard from './SketchCard'
import { useSheetDrag } from '../../lib/useSheetDrag'

/**
 * A sketch's card in a phone's bottom sheet (November 14, 2026), the same
 * sheet as Edit Sketch's (.sc-sheet, useSheetDrag): a map pin opens it
 * instead of a popup, which a small map cut off. Open, it shows the full
 * card (SketchCard with details) at the sheet's width; dragged or tapped
 * down, the compact row. Phones only: on a computer the pin keeps its popup.
 *
 *   sketch   the sketch, as the API returns it
 *   onClose  the close button, or a tap on the map
 */
export default function SketchSheet({ sketch, onClose }) {
  const [open, setOpen] = useState(true)
  const sheet = useSheetDrag(open, setOpen, '.sketch-sheet-head')
  return createPortal(
    <div ref={sheet.ref} style={sheet.style} role="dialog" aria-label={sketch.title || 'Sketch'}
      className={`sc-sheet ${sheet.className} flex flex-col bg-white text-ink max-md:!z-[1200] md:hidden`}>
      <div className="relative">
        <button type="button" className="sc-sheet-handle touch-none" {...sheet.handleProps}
          aria-label={open ? 'Fold the card down' : 'Show the card'} aria-expanded={open}>
          <span />
        </button>
        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute right-2 top-1 flex h-8 w-8 items-center justify-center rounded-full text-ink/70 hover:bg-ink/5">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="sketch-sheet-head px-4 pb-3 empty:hidden">
        {!open && <SketchCard sketch={sketch} compact />}
      </div>
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          <SketchCard sketch={sketch} details />
        </div>
      )}
    </div>,
    document.body,
  )
}
