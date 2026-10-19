import { useEffect, useMemo, useState } from 'react'
import { Color, mix } from 'spectral.js'
import { tileHex } from './GamutWheel'
import { bestRecipe, greyOf, lightness, tilesInMask, valueStep } from '../../lib/gamutMask'

const MAX_COLOURS = 12
const PAPER = new Color('#ffffff')
// Full strength, half water, and a thin wash: watercolour gets lighter
// with water, so each mix reaches several values. Water is modelled as
// mixing with the white of the paper.
const STRENGTHS = [
  { key: 'full', water: 0 },
  { key: 'half', water: 1 },
  { key: 'thin', water: 3 },
]

/**
 * "Colours in your mask, by value" (design doc, item 37): one bar per
 * value, 1 (darkest) to 9 (lightest), like the Value tab's distribution.
 * In each bar, stacked, every colour in the mask that lands on that value:
 * the closest mix from the sketcher's paints, at full strength, half
 * water or as a thin wash. So the sketcher sees which colours can share a
 * value, and how light or dark each can go. Worked out a moment after the
 * mask stops moving.
 */
export default function MaskValues({ shapes, paints, onSelect }) {
  const [stable, setStable] = useState(shapes)
  useEffect(() => {
    const t = setTimeout(() => setStable(shapes), 250)
    return () => clearTimeout(t)
  }, [shapes])

  const bars = useMemo(() => {
    // Spread the tiles by value first, so only a dozen need a recipe.
    let tiles = tilesInMask(stable).map((tile) => ({ tile, hex: tileHex(tile) }))
    tiles.forEach((t) => { t.tileL = lightness(t.hex) })
    tiles.sort((a, b) => a.tileL - b.tileL)
    if (tiles.length > MAX_COLOURS) {
      tiles = Array.from({ length: MAX_COLOURS }, (_, i) => tiles[Math.round((i * (tiles.length - 1)) / (MAX_COLOURS - 1))])
    }
    const out = Array.from({ length: 9 }, () => [])
    const seen = new Set()
    for (const t of tiles) {
      const full = new Color(bestRecipe(t.hex, paints).hex)
      for (const s of STRENGTHS) {
        const hex = s.water ? mix([full, 1], [PAPER, s.water]).toString() : full.toString()
        if (seen.has(hex)) continue
        seen.add(hex)
        const step = valueStep(lightness(hex))
        out[step - 1].push({ hex, tile: t.tile, strength: s.key })
      }
    }
    return out
  }, [stable, paints])

  if (!bars.some((b) => b.length)) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="sc-field-label">Colours in your mask, by value</span>
      <div className="flex items-end gap-1">
        {bars.map((chips, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-col-reverse">
              {chips.map((c, j) => (
                <button key={j} type="button" title={c.strength === 'full' ? 'Full strength' : c.strength === 'half' ? 'With water' : 'A thin wash'}
                  onClick={() => onSelect({ h: c.tile.h, c: c.tile.c, hex: c.hex, from: 'wheel' })}
                  className="h-3 w-full border-t border-black/30 first:border-t-0 hover:outline hover:outline-1 hover:outline-white"
                  style={{ background: c.hex }} aria-label={`A colour at value ${i + 1}`} />
              ))}
            </div>
            <span className="h-4 w-full border border-[#cccccc]/60" style={{ background: greyOf((i) / 8) }} />
            <span className="text-xs text-sc-text3">{i + 1}</span>
          </div>
        ))}
      </div>
      <p className="text-sm text-sc-text3">Each mix at full strength, with water, and as a thin wash. 1 is darkest, 9 is lightest. Tap a colour to mix it.</p>
    </div>
  )
}
