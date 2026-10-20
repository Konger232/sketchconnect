import { useState } from 'react'
import GamutWheel from './GamutWheel'
import MaskValues from './MaskValues'
import { presetShapes, resizeShape, shapeSize } from '../../lib/gamutMask'

const SIZE_MIN = 0.05 // the size slider, in wheel radii
const SIZE_MAX = 0.9

// The shape icons under the wheel.
const SHAPES = [
  { key: 'triangle', label: 'Triad', icon: <path d="M12 3 21 20H3Z" /> },
  { key: 'diamond', label: 'Diamond', icon: <path d="M12 2 18 12 12 22 6 12Z" /> },
  { key: 'circles', label: 'Mood & Accent', icon: <><circle cx="9" cy="14" r="7" /><circle cx="19.5" cy="5" r="3" /></> },
  { key: 'none', label: 'No mask', icon: <><circle cx="12" cy="12" r="9" /><path d="M5.6 18.4 18.4 5.6" /></> },
]

/**
 * The Color tab's right panel (design doc, item 37). The sketcher shapes
 * the gamut mask freely; SketchConnect then says how to mix a colour from
 * the paints they have. Kept short: the wheel, the shape icons, the size
 * slider and the chart. The recipe shows on the photo (RecipeStrip).
 *
 *   shapes, onChange(shapes, { done })   the mask
 *   paints, fromKit                      the sketcher's paints (or common ones)
 *   selected { h, c, hex, from } | null  a tile, or a spot on the photo
 *   onSelect(selected)
 */
// James Gurney's method, which the Color tab follows.
const GURNEY = 'https://gurneyjourney.blogspot.com/2011/09/part-1-gamut-masking-method.html'
const gamutLink = (
  <a href={GURNEY} target="_blank" rel="noreferrer" className="underline decoration-white/40 underline-offset-2 hover:decoration-white">gamut mask</a>
)
const LABEL = 'text-xs font-semibold text-sc-text2'

export default function ColorPanel({ shapes, onChange, paints, fromKit, selected, onSelect, onPickTile, marked, isSwatch, onRemoveSwatch, readOnly }) {
  const [active, setActive] = useState(0)
  const [preset, setPreset] = useState(null)
  const shape = shapes.length ? shapes[Math.min(active, shapes.length - 1)] : null
  const size = shape ? shapeSize(shape) : SIZE_MIN

  function setSize(v) {
    if (!shape) return
    const n = Math.max(SIZE_MIN, Math.min(SIZE_MAX, v))
    onChange(shapes.map((s) => (s === shape ? resizeShape(s, n) : s)), { done: true })
  }
  function pickPreset(key) {
    setPreset(key)
    setActive(0)
    onChange(key === 'none' ? [] : presetShapes(key), { done: true })
  }


  return (
    <div className="flex flex-col gap-4">
      <p className="text-md text-white">
        {readOnly ? <>Your {gamutLink}, as planned.</> : <>Shape your {gamutLink} on the wheel. Then tap colours in the chart to collect them; each one shows how to mix it from your paints.</>}
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
            <div className="flex shrink-0 flex-col gap-1">
            <span className={LABEL}>Mask Shape</span>
            <div className="flex gap-1.5" role="group" aria-label="Mask shape">
              {SHAPES.map((s) => (
                <button key={s.key} type="button" onClick={() => pickPreset(s.key)} aria-pressed={preset === s.key || (s.key === 'none' && !shapes.length)}
                  title={s.label} aria-label={s.label} className="flex w-10 flex-col items-center">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-lg border-[1.5px] transition-colors ${
                    preset === s.key || (s.key === 'none' && !shapes.length) ? 'border-white bg-white/10' : 'border-sc-border hover:border-sc-strong'
                  }`}>
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#cccccc" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">{s.icon}</svg>
                  </span>
                </button>
              ))}
            </div>
            </div>
            <div className={`flex min-w-0 flex-1 flex-col gap-1 ${shape ? '' : 'pointer-events-none opacity-40'}`}>
              <span className={LABEL}>Mask Size</span>
              <div className="flex h-10 w-full items-center gap-1">
                <button type="button" aria-label="Smaller" onClick={() => setSize(size - 0.05)}
                  className="flex h-8 w-4 shrink-0 items-center justify-center text-lg font-bold text-white hover:text-sc-guide">−</button>
                <input type="range" min={SIZE_MIN} max={SIZE_MAX} step={0.01} value={Math.min(SIZE_MAX, size)} aria-label="Mask size"
                  onChange={(e) => setSize(Number(e.target.value))} className="h-1.5 min-w-0 flex-1 accent-sc-guide" />
                <button type="button" aria-label="Bigger" onClick={() => setSize(size + 0.05)}
                  className="flex h-8 w-4 shrink-0 items-center justify-center text-lg font-bold text-white hover:text-sc-guide">+</button>
              </div>
            </div>
          </div>
        </>
      )}

      {!shapes.length && (
        <p className="m-0 text-sm text-sc-text3">No mask: the whole wheel is open. Pick a shape to see its colours by value.</p>
      )}
      <MaskValues shapes={shapes} paints={paints} onToggle={onPickTile} marked={marked} />

      <p className="m-0 text-sm text-sc-text3">Tap a colour in the chart, or a spot on the photo, to see how to mix it.</p>
      <p className="text-sm text-sc-text3">
        {fromKit ? 'Mixed from the paints in your kit.' : 'Mixed from the starter palette. Add your own paints in My kit on your page.'} Parts are a starting point.
      </p>
    </div>
  )
}
