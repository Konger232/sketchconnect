import { OPACITY, paintLabel } from '../../data/paints'

export const opacityOf = (paint) => OPACITY.find((o) => o.value === paint?.opacity) || null

// The tube's opacity square, drawn so all four are the same size (the
// text symbols ⬜ ◪ ◩ ⬛ are not, in most fonts): empty, half filled
// along the diagonal, three quarters filled, full.
const FILL = {
  transparent: null,
  semi_transparent: 'M11 1 L11 11 L1 11 Z',
  semi_opaque: 'M6 1 L11 1 L11 11 L1 11 L1 6 Z',
  opaque: 'M1 1 H11 V11 H1 Z',
}
export function OpacityIcon({ value, className = '' }) {
  if (!(value in FILL)) return null
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" className={`inline-block shrink-0 align-[-1px] ${className}`}>
      <rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {FILL[value] && <path d={FILL[value]} fill="currentColor" />}
    </svg>
  )
}

/**
 * What a paint is, the same everywhere it is pointed at (the wheel's
 * circles, the pills, the pans): its name, then
 *   Pigment(s)    PB29 + PBk9, and whether it is a single pigment
 *   Description   which way it leans ("a blue-grey (cool)")
 *   Opacity       the tube's square symbol and what it means
 */
export function PaintTipContent({ paint }) {
  const codes = paint.codes || []
  const op = opacityOf(paint)
  return (
    <>
      <span className="block font-bold">{paintLabel(paint)}</span>
      <span className="block">
        {codes.length > 1 ? 'Pigments' : 'Pigment'}: {paint.code}
        <span className="text-white/60">{codes.length > 1 ? ' · a convenience mix' : codes.length === 1 ? ' · single pigment' : ''}</span>
      </span>
      {paint.lean && <span className="block text-white/80">{paint.lean}</span>}
      {op && <span className="flex items-center gap-1.5 text-white/80"><OpacityIcon value={op.value} /> {op.label}: {op.note}</span>}
    </>
  )
}

/** The tip box, above a point (x, y in px or %, in its positioned parent). */
export default function PaintTip({ paint, x, y }) {
  if (!paint) return null
  return (
    <div role="tooltip" className="pointer-events-none absolute z-40 w-max max-w-[280px] rounded-md bg-black/90 px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg"
      style={{ left: x, top: y, transform: 'translate(-50%, calc(-100% - 10px))' }}>
      <PaintTipContent paint={paint} />
    </div>
  )
}

/** The opacity symbols and what they mean, for under the wheel. */
export function OpacityLegend() {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[11px] text-ink/65">
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full border border-ink/40 bg-[#808080]" /> A paint in the palette
      </li>
      {OPACITY.map((o) => (
        <li key={o.value} className="flex items-center gap-1.5">
          <span className="flex w-3 justify-center"><OpacityIcon value={o.value} /></span> <span><span className="font-semibold">{o.label}</span>: {o.note}</span>
        </li>
      ))}
    </ul>
  )
}
