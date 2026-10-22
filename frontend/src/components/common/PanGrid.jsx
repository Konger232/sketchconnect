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
 *   onPanDown(pan, e)   a press on a pan (Edit palette starts a drag or a pick)
 *   size                a half pan's width in px (its height is 1.24 times)
 */
export default function PanGrid({ layout, editable = false, selected, dropAt, onPanDown, size = 34 }) {
  // The pans shrink to fit a phone's width.
  const w = `min(${size}px, calc((100vw - 96px) / ${layout.cols}))`
  const same = (a, p) => a && p.r === a.r && p.c === a.c
  return (
    <div className="inline-block rounded-md bg-[#d9d9d6] p-2 shadow-[inset_0_1px_3px_rgba(0,0,0,0.25)]">
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${layout.cols}, ${w})`, gridAutoRows: `calc(${w} * 1.24)` }}>
        {allPans(layout).map((p) => {
          const paint = p.paint ? paintById(p.paint) : null
          const tip = paint ? `${paint.code} ${paint.name}` : p.w * p.h > 1 ? 'Empty full pan' : 'Empty half pan'
          const on = same(selected, p) || (dropAt && same(dropAt, p))
          return (
            <div key={`${p.r}-${p.c}`} data-pan={`${p.r},${p.c}`} aria-label={tip} data-tip={paint ? tip : undefined}
              role={editable ? 'button' : 'img'} tabIndex={editable ? 0 : undefined}
              onPointerDown={editable ? (e) => onPanDown?.(p, e) : undefined}
              className={`${paint ? 'has-tip' : ''} rounded-[3px] border border-black/10 bg-white p-[3px] ${editable ? 'cursor-grab touch-none' : ''} ${
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
