import { paintLabel } from '../../data/paints'

/**
 * My palette's paints as pills (design doc, items 45 and 46): a swatch and
 * the pigment code, and with showNames the paint's name under it. The pill
 * in focus is outlined; with `placed`, a paint in no pan has a dashed edge.
 * Used under the tin in Edit palette and on the Sketcher page.
 *
 *   paints [paint]   focusId   placed (Set of ids, Edit palette)
 *   onPillDown(paint, e)   a press: Edit palette starts a drag or a tap,
 *                          the Sketcher page picks the paint
 *   children          after the pills (Edit palette: Add paint)
 */
export default function PaintPills({ paints, focusId, placed, onPillDown, showNames = false, children }) {
  return (
    <div className="flex flex-wrap gap-2">
      {paints.map((p) => (
        <button key={p.id} type="button" aria-pressed={focusId === p.id} aria-label={paintLabel(p)}
          data-tip={showNames ? undefined : paintLabel(p)}
          onPointerDown={onPillDown ? (e) => onPillDown(p, e) : undefined}
          className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-left text-xs ${showNames ? '' : 'has-tip touch-none'} ${
            focusId === p.id ? 'border-ink ring-1 ring-ink' : 'border-ink/20'
          } ${placed && !placed.has(p.id) ? 'border-dashed' : ''}`}>
          {/* The swatch is data: an inline background. */}
          <span className="h-5 w-5 shrink-0 rounded-full border border-black/10" style={{ background: p.hex }} />
          <span className="flex flex-col leading-tight">
            <span className="font-bold">{p.code}</span>
            {showNames && <span className="text-ink/70">{paintLabel(p)}</span>}
          </span>
        </button>
      ))}
      {children}
    </div>
  )
}
