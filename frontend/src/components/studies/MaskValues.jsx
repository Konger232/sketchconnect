import { useEffect, useMemo, useState } from 'react'
import { tileHex } from './GamutWheel'
import { bestRecipe, greyOf, lightness, tilesInMask, valueStep } from '../../lib/gamutMask'

const MAX_COLUMNS = 12

/**
 * "Colours in your mask, darkest to lightest" (design doc, item 37): the
 * tiles inside the mask, each as the closest mix from the sketcher's
 * paints, set out as a value scale, like the Value tab's distribution.
 * Under each mix, the grey of the same value and its number (1 darkest,
 * 9 lightest), so an orange and a light blue can be compared by value.
 * Worked out a moment after the mask stops moving.
 */
export default function MaskValues({ shapes, paints, onSelect }) {
  const [stable, setStable] = useState(shapes)
  useEffect(() => {
    const t = setTimeout(() => setStable(shapes), 250)
    return () => clearTimeout(t)
  }, [shapes])

  const columns = useMemo(() => {
    // Spread the tiles along the value scale first, so only a dozen need a recipe.
    let tiles = tilesInMask(stable).map((tile) => ({ tile, hex: tileHex(tile) }))
    tiles.forEach((t) => { t.tileL = lightness(t.hex) })
    tiles.sort((a, b) => a.tileL - b.tileL)
    if (tiles.length > MAX_COLUMNS) {
      tiles = Array.from({ length: MAX_COLUMNS }, (_, i) => tiles[Math.round((i * (tiles.length - 1)) / (MAX_COLUMNS - 1))])
    }
    const seen = new Set()
    return tiles
      .map((t) => { const r = bestRecipe(t.hex, paints); return { ...t, mix: r.hex, L: lightness(r.hex) } })
      .filter((c) => (seen.has(c.mix) ? false : seen.add(c.mix)))
      .sort((a, b) => a.L - b.L)
  }, [stable, paints])

  if (!columns.length) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="sc-field-label">Colours in your mask, darkest to lightest</span>
      <div className="flex gap-1">
        {columns.map((c, i) => (
          <button key={i} type="button" onClick={() => onSelect({ h: c.tile.h, c: c.tile.c, hex: c.hex, from: 'wheel' })}
            title="See how to mix it" className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="h-10 w-full border border-[#cccccc]/60" style={{ background: c.mix }} />
            <span className="h-5 w-full border border-[#cccccc]/60" style={{ background: greyOf(c.L) }} />
            <span className="text-xs text-sc-text3">{valueStep(c.L)}</span>
          </button>
        ))}
      </div>
      <p className="text-sm text-sc-text3">Top: the mix from your paints, at full strength. Below: its value, 1 darkest to 9 lightest.</p>
    </div>
  )
}
