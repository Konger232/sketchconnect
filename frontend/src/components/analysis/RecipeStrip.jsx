import { useMemo } from 'react'
import { Color, mix } from 'spectral.js'
import { tileAt, tileHex } from './GamutWheel'
import { bestRecipe, recipeLine } from '../../lib/gamutMask'

const PAPER = new Color('#ffffff')
// The chart's three strengths (MaskValues): the mix with 0, 1 or 3 parts water.
const WATER = [
  { water: 0, note: null },
  { water: 1, note: 'Add about as much water as paint.' },
  { water: 3, note: 'Thin it to a light wash, about 3 parts water.' },
]
const same = (a, b) => a.toLowerCase() === b.toLowerCase()

// The recipe for a selected colour. A chart colour is a known mix at a known
// strength, so it says that; a spot on the photo gets the closest mix.
export function recipeFor(selected, paints) {
  const tile = selected.from === 'wheel' ? tileAt(selected) : null
  if (tile) {
    const recipe = bestRecipe(tileHex(tile), paints)
    if (recipe) {
      const full = new Color(recipe.hex)
      const hit = WATER.find((w) => same(w.water ? mix([full, 1], [PAPER, w.water]).toString() : full.toString(), selected.hex))
      if (hit) return { recipe, note: hit.note }
    }
  }
  const recipe = bestRecipe(selected.hex, paints)
  if (!recipe) return null
  const note = recipe.water === 'more' ? 'Add more water to lighten it.' : recipe.water === 'less' ? 'Use less water, or paint a second layer.' : null
  return { recipe, note }
}

/**
 * How to mix the selected colour, as a strip across the bottom of the photo
 * (design doc, item 37): the colour, and the recipe from the sketcher's
 * paints. Sits inside StripImage's `overlay`.
 */
export default function RecipeStrip({ selected, paints, onClose }) {
  const r = useMemo(() => (selected ? recipeFor(selected, paints) : null), [selected, paints])
  if (!selected || !r) return null
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-center gap-3 bg-black/60 px-3 py-2.5"
      onClick={(e) => e.stopPropagation()}>
      <span className="h-10 w-10 shrink-0 border border-white" style={{ background: selected.hex }} />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-md font-semibold text-white">{recipeLine(r.recipe)}</p>
        {r.note && <p className="m-0 text-sm text-white/75">{r.note}</p>}
      </div>
      <button type="button" aria-label="Close the recipe" onClick={onClose}
        className="flex h-8 w-8 shrink-0 items-center justify-center text-lg text-white/80 hover:text-white">×</button>
    </div>
  )
}
