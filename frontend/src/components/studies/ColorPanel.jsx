import { useMemo, useState } from 'react'
import GamutWheel from './GamutWheel'
import MaskValues from './MaskValues'
import { bestRecipe, maskContains, presetShapes, recipeLine, resizeShape, shapeSize, toUnit } from '../../lib/gamutMask'

const SIZE_MIN = 0.05 // the size slider, in wheel radii
const SIZE_MAX = 0.9

// The shape icons under the wheel.
const SHAPES = [
  { key: 'triangle', label: 'Triad', icon: <path d="M12 3 21 20H3Z" /> },
  { key: 'diamond', label: 'Diamond', icon: <path d="M12 2 18 12 12 22 6 12Z" /> },
  { key: 'circles', label: 'Mood & Accent', icon: <><circle cx="9" cy="14" r="7" /><circle cx="19.5" cy="5" r="3" /></> },
]

/**
 * The Color tab's right panel (design doc, item 37). The sketcher shapes
 * the gamut mask freely; SketchConnect then says how to mix a colour from
 * the paints they have. Kept short: the wheel, the shape icons, the size
 * slider, and the selected colour with its recipe.
 *
 *   shapes, onChange(shapes, { done })   the mask
 *   paints, fromKit                      the sketcher's paints (or common ones)
 *   selected { h, c, hex, from } | null  a tile, or a spot on the photo
 *   onSelect(selected)
 */
export default function ColorPanel({ shapes, onChange, paints, fromKit, selected, onSelect, onPickTile, marked, isSwatch, onRemoveSwatch, readOnly }) {
  const [active, setActive] = useState(0)
  const [preset, setPreset] = useState(null)
  const shape = shapes[Math.min(active, shapes.length - 1)]
  const size = shapeSize(shape)

  function setSize(v) {
    const n = Math.max(SIZE_MIN, Math.min(SIZE_MAX, v))
    onChange(shapes.map((s) => (s === shape ? resizeShape(s, n) : s)), { done: true })
  }
  function pickPreset(key) {
    setPreset(key)
    setActive(0)
    onChange(presetShapes(key), { done: true })
  }

  const recipe = useMemo(() => (selected ? bestRecipe(selected.hex, paints) : null), [selected, paints])
  const inside = selected ? maskContains(shapes, toUnit(selected)) : true

  return (
    <div className="flex flex-col gap-4">
      <p className="text-md text-white">
        {readOnly ? 'Your gamut mask, as planned.' : 'Shape your gamut mask on the wheel. Then tap colours in the chart to collect them; each one shows how to mix it from your paints.'}
      </p>
      {readOnly && (
        <p className="-mt-2 text-sm text-sc-text3">
          The mask is locked with the plan, because this sketch is shared. To change it, delete the final sketch on its page. You can still collect colours from the chart.
        </p>
      )}

      <GamutWheel shapes={shapes} onChange={onChange} active={active} onActive={setActive} paints={paints} readOnly={readOnly} />

      {!readOnly && (
        <>
          {/* The shapes and the size, in one row. */}
          <div className="flex items-start gap-3">
            <div className="flex shrink-0 gap-1.5" role="group" aria-label="Mask shape">
              {SHAPES.map((s) => (
                <button key={s.key} type="button" onClick={() => pickPreset(s.key)} aria-pressed={preset === s.key}
                  className="flex w-12 flex-col items-center gap-0.5">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-lg border-[1.5px] transition-colors ${
                    preset === s.key ? 'border-white bg-white/10' : 'border-sc-border hover:border-sc-strong'
                  }`}>
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#cccccc" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">{s.icon}</svg>
                  </span>
                  <span className="text-center text-[10px] font-semibold leading-tight text-sc-text2">{s.label}</span>
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
              <span className="text-xs font-semibold text-sc-text2">Mask size</span>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Smaller" onClick={() => setSize(size - 0.05)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white hover:bg-white/10">−</button>
                <input type="range" min={SIZE_MIN} max={SIZE_MAX} step={0.01} value={Math.min(SIZE_MAX, size)} aria-label="Mask size"
                  onChange={(e) => setSize(Number(e.target.value))} className="h-1.5 min-w-0 flex-1 accent-sc-guide" />
                <button type="button" aria-label="Bigger" onClick={() => setSize(size + 0.05)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white hover:bg-white/10">+</button>
              </div>
            </div>
          </div>
        </>
      )}

      <MaskValues shapes={shapes} paints={paints} onToggle={onPickTile} marked={marked} />

      {/* The selected colour, and how to mix it from the sketcher's paints. */}
      {selected && recipe ? (
        <div className="flex flex-col gap-2 rounded-xl border border-sc-border p-3">
          <div className="flex items-center gap-3">
            <span className="h-12 w-12 shrink-0 border border-[#cccccc]" style={{ background: selected.hex }} title="The colour" />
            <span className="text-lg text-sc-text3">≈</span>
            <span className="h-12 w-12 shrink-0 border border-[#cccccc]" style={{ background: recipe.hex }} title="Your mix" />
            <span className="text-sm text-sc-text2">
              {selected.from === 'photo' ? 'This spot in the photo' : 'This colour'}
              {!inside && <span className="block text-sc-text3">Outside your mask</span>}
            </span>
          </div>
          <p className="m-0 text-md font-semibold text-white">{recipeLine(recipe)}</p>
          {recipe.water && (
            <p className="m-0 text-sm text-sc-text3">{recipe.water === 'more' ? 'Add more water to lighten it.' : 'Use less water, or paint a second layer.'}</p>
          )}
          {isSwatch && (
            <button type="button" onClick={onRemoveSwatch} className="self-start text-sm font-semibold text-sc-text2 underline hover:text-white">
              Remove from your colours
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-sc-text3">Tap a colour in the chart, or a spot on the photo.</p>
      )}
      <p className="text-sm text-sc-text3">
        {fromKit ? 'Mixed from the paints in your kit.' : 'Mixed from a starter palette: a warm and a cool of each primary. Add your own paints in My kit on your page.'} Parts are a starting point.
      </p>
    </div>
  )
}
