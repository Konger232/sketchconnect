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
 * "Colours in your mask, by value" (design doc, item 37): one row per
 * value, 1 (lightest) to 9 (darkest), like the Value tab's distribution.
 * In each bar, stacked, every colour in the mask that lands on that value:
 * the closest mix from the sketcher's paints, at full strength, half
 * water or as a thin wash. So the sketcher sees which colours can share a
 * value, and how light or dark each can go. Worked out a moment after the
 * mask stops moving.
 */
export default function MaskValues({ shapes, paints, onToggle, marked = [], readOnly = false }) {
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
      <h3 className="text-white">Selected Color Values</h3>
      {/* <span className="sc-field-label">Selected Color Values</span> */}
      <p className="text-sm text-sc-text3">
        Each mix at full strength, with water, and as a thin wash. 1 is the lightest, 9 the darkest. 
        {!readOnly && 'Tap a colour to collect it and see how to mix it; tap it again to take it out.'}</p>
        {!readOnly && <p className="m-0 text-sm text-sc-text3">Tap a colour in the chart, or a spot on the photo, to see how to mix it.</p>}
     
      {/* One row per value, lightest first (1 is the lightest): its number,
          its grey, and the colours on it. `bars` comes darkest first. */}
      
      <div className="flex flex-col gap-1">
        {bars.map((chips, i) => ({ chips, i })).reverse().map(({ chips, i }) => (
          <div key={i} className="flex items-start gap-2">
            <span className="flex h-6 w-4 shrink-0 items-center justify-end text-xs text-sc-text3">{9 - i}</span>
            <span className="h-6 w-6 shrink-0 border border-[#cccccc]/60" style={{ background: greyOf(i / 8) }} />
            {/* Tiled from the top left; a long row wraps under itself. */}
            <div className="flex min-h-6 min-w-0 flex-1 flex-wrap content-start items-start">
              {chips.map((c, j) => (
                <button key={j} type="button" disabled={readOnly} title={c.strength === 'full' ? 'Full strength' : c.strength === 'half' ? 'With water' : 'A thin wash'}
                  onClick={() => onToggle?.({ h: c.tile.h, c: c.tile.c, hex: c.hex, from: 'wheel' })}
                  aria-pressed={marked.some((m) => m.hex === c.hex)}
                  className="relative h-6 w-6 border-l border-black/30 disabled:cursor-default first:border-l-0 hover:z-10 hover:outline hover:outline-1 hover:outline-white/60"
                  style={{
                    background: c.hex,
                    // Collected into "Your colours": a 1px white border.
                    boxShadow: marked.some((m) => m.hex === c.hex) ? '0 0 0 1px #ffffff' : undefined,
                  }}
                  aria-label={`A colour at value ${9 - i}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
      </div>
  )
}
