import Icon from './Icon'
import { readableInk, warmToCool } from '../../lib/color'

/**
 * A palette as vertical bars (design handoff, Sketch Detail), sorted warm,
 * neutral, cool. Each bar names its closest paint ("≈ PY43 · Yellow
 * Ochre" for the scene; the sketch's own paints without "≈"). The text is
 * #111 or #fff by contrast. With onEdit / onRemove, each bar gets a pencil
 * and a bin (the owner, on the final sketch's palette).
 */
export default function PaletteBars({ paints, approx = false, onEdit, onRemove }) {
  const sorted = warmToCool(paints)
  return (
    <ul className="flex flex-col">
      {sorted.map((p) => {
        const ink = readableInk(p.hex)
        return (
          // The swatch colour and its text colour are data: inline.
          <li key={p.id} data-paint-row className="swatch-bar" style={{ background: p.hex, color: ink }}>
            <span className="flex flex-col py-2">
              <span className="text-2xs font-bold tracking-[0.06em]">{approx ? '≈ ' : ''}{p.code}</span>
              <span className="text-md font-medium">{p.name}</span>
            </span>
            {(onEdit || onRemove) && (
              <span className="flex items-center gap-1">
                {onEdit && (
                  <button type="button" className="flex h-9 w-9 items-center justify-center" aria-label={`Change ${p.name}`} onClick={(e) => onEdit(p, e.currentTarget)}>
                    <Icon name="edit" size={14} />
                  </button>
                )}
                {onRemove && (
                  <button type="button" className="flex h-9 w-9 items-center justify-center" aria-label={`Remove ${p.name}`} onClick={() => onRemove(p)}>
                    <Icon name="delete" size={15} />
                  </button>
                )}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
