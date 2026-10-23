import { OPACITY, paintDescription } from '../../data/paints'
import TipCard from './TipCard'

export const opacityOf = (paint) => OPACITY.find((o) => o.value === paint?.opacity) || null

// The tube's opacity square, as makers print it, drawn so all four are
// the same size: empty (transparent), a diagonal (semi-transparent), the
// upper left half filled (semi-opaque), full (opaque).
const FILL = {
  transparent: null,
  semi_transparent: null,
  semi_opaque: 'M1 1 H11 L1 11 Z',
  opaque: 'M1 1 H11 V11 H1 Z',
}
export function OpacityIcon({ value, className = '' }) {
  if (!(value in FILL)) return null
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" className={`inline-block shrink-0 align-[-1px] ${className}`}>
      <rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {value === 'semi_transparent' && <path d="M1 11 L11 1" stroke="currentColor" strokeWidth="1.2" />}
      {FILL[value] && <path d={FILL[value]} fill="currentColor" />}
    </svg>
  )
}

/**
 * What a paint is, the same everywhere it is pointed at (the wheel's
 * circles, the pills, the pans), one thing per line:
 *   Cadmium Yellow (PY35)        the name and its pigment(s)
 *   Daniel Smith                 the brand, when it has one
 *   a muted yellow, an earth     what it is (not warm or cool: the wheel shows that)
 *   [square] Opaque: covers...   the tube's opacity
 */
export function PaintTipContent({ paint }) {
  const op = opacityOf(paint)
  return (
    <>
      <span className="font-semibold">{paint.name} ({paint.code})</span>
      {paint.brand && <span>{paint.brand}</span>}
      {paintDescription(paint.lean) && <span className="text-ink/70">{paintDescription(paint.lean)}</span>}
      {op && (
        <span className="flex items-start gap-1.5 text-ink/70">
          <OpacityIcon value={op.value} className="mt-[3px] text-ink" />
          <span>{op.label}: {op.note}</span>
        </span>
      )}
    </>
  )
}

/** The tip card, above a point (x, y in px or %, in its positioned parent). */
export default function PaintTip({ paint, x, y }) {
  if (!paint) return null
  return (
    <TipCard as="div" role="tooltip" className="pointer-events-none absolute z-40 w-max max-w-[280px]"
      style={{ left: x, top: y, transform: 'translate(-50%, calc(-100% - 10px))' }}>
      <PaintTipContent paint={paint} />
    </TipCard>
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
          <span className="flex w-3 justify-center"><OpacityIcon value={o.value} className="text-ink" /></span> <span><span className="font-semibold">{o.label}</span>: {o.note}</span>
        </li>
      ))}
    </ul>
  )
}
