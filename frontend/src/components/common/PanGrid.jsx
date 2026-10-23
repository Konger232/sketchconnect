import { useEffect, useRef, useState } from 'react'
import { paintById } from '../../data/paints'
import { allPans } from '../../lib/paletteLayout'

/**
 * My palette's pans, as the sketcher's tin is laid out (design doc, item
 * 45): a grid of half pans, a full pan over two cells. Used read-only on
 * the Sketcher page and to edit in Edit palette.
 *
 *   layout              { rows, cols, pans }   (lib/paletteLayout.js)
 *   editable            pans can be picked and dragged
 *   selected { r, c }   the pan picked, outlined
 *   dropAt { r, c }     the pan a paint is being dragged over
 *   onPanDown(pan, e)   a press on a pan (Edit palette: a drag or a pick;
 *                       the Sketcher page: a pick)
 *   size                a half pan's width in px (its height is 1.24 times)
 */
export default function PanGrid({ layout, editable = false, selected, dropAt, onPanDown, size = 34 }) {
  // The pans shrink to fit the space they have (a 12-column tin, a phone).
  const boxRef = useRef(null)
  const [room, setRoom] = useState(null)
  useEffect(() => {
    const el = boxRef.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setRoom(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const GAP = 4, FRAME = 16
  const fit = room ? Math.floor((room - FRAME - GAP * (layout.cols - 1)) / layout.cols) : size
  const w = `${Math.max(14, Math.min(size, fit))}px`
  const same = (a, p) => a && p.r === a.r && p.c === a.c
  return (
    <div ref={boxRef} className="inline-block max-w-full rounded-md bg-[#d9d9d6] p-2 shadow-[inset_0_1px_3px_rgba(0,0,0,0.25)]">
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${layout.cols}, ${w})`, gridAutoRows: `calc(${w} * 1.24)` }}>
        {allPans(layout).map((p) => {
          const paint = p.paint ? paintById(p.paint) : null
          const tip = paint ? `${paint.code} ${paint.name}` : p.w * p.h > 1 ? 'Empty full pan' : 'Empty half pan'
          const on = same(selected, p) || (dropAt && same(dropAt, p))
          return (
            <div key={`${p.r}-${p.c}`} data-pan={`${p.r},${p.c}`} aria-label={tip} data-tip={paint ? tip : undefined}
              role={onPanDown ? 'button' : 'img'} tabIndex={onPanDown ? 0 : undefined}
              onPointerDown={onPanDown ? (e) => onPanDown(p, e) : undefined}
              className={`${paint ? 'has-tip' : ''} rounded-[3px] border border-black/10 bg-white p-[3px] ${editable ? 'cursor-grab touch-none' : onPanDown && paint ? 'cursor-pointer' : ''} ${
                on ? 'outline outline-2 outline-offset-1 outline-ink' : ''
              }`}
              style={{ gridRow: `${p.r + 1} / span ${p.h}`, gridColumn: `${p.c + 1} / span ${p.w}` }}>
              {/* The paint is data: an inline background. */}
              {paint
                ? <span className="block h-full w-full rounded-[2px]" style={{ background: paint.hex }} />
                : <span className="block h-full w-full rounded-[2px] border border-dashed border-black/15" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
