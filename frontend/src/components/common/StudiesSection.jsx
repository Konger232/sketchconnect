import { useEffect, useState } from 'react'
import GamutWheel from '../analysis/GamutWheel'
import MaskValues from '../analysis/MaskValues'
import RuleOfThirdsGrid from '../analysis/RuleOfThirdsGrid'
import { ValueChart } from '../analysis/ValuePanel'
import { useMaskedPhoto } from '../analysis/ColorStage'
import { recipeFor } from '../analysis/RecipeStrip'
import { readMask, recipeLine } from '../../lib/gamutMask'
import { kitPaintList, starterPaints } from '../../data/paints'
import { api } from '../../lib/api'

const noop = () => {}

/**
 * SketchDetail's Value and Color studies (design doc, item 37), from the
 * Edit Sketch Value and Color tabs. Separate sections, each only when the
 * sketcher used that tab: a fountain pen sketcher may plan values and no
 * colour.
 */

// Values: the photo in the chosen values (left); how many, and the value
// distribution chart (right).
export function ValueSection({ sketch }) {
  const levels = sketch.value_levels
  const [study, setStudy] = useState(null) // null loading, false failed

  useEffect(() => {
    if (!levels) return
    setStudy(null)
    api.get(`/api/sketches/${sketch.id}/value-study`, { params: { levels, scale: true } })
      .then(({ data }) => setStudy(data))
      .catch(() => setStudy(false))
  }, [sketch.id, levels])

  if (!levels) return null
  return (
    <section className="ed-section">
      <h2 className="ed-kicker m-0">The value study</h2>
      <div className="grid gap-8 md:grid-cols-2 md:gap-14">
        {study ? (
          <div className="relative">
            <img src={study.valueStudyImage} alt={`The reference photo in ${levels} values`} className="block w-full" />
            <RuleOfThirdsGrid />
          </div>
        ) : (
          <p className={`ed-note m-0 ${study === null ? 'animate-pulse' : ''}`}>
            {study === null ? 'Reading the values…' : 'The value study is not available right now.'}
          </p>
        )}
        <div className="flex flex-col gap-3">
          <h3 className="m-0 font-sans text-lg font-normal">{levels} value levels</h3>
          {study && (
            <div className="flex flex-col gap-2 bg-black p-4">
              <span className="sc-field-label">Value distribution, %</span>
              <ValueChart study={study} />
              <p className="m-0 text-sm text-sc-text3">1 is the lightest, the white of the paper.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// Colour: the mask on the wheel (left) and its colour value chart (right);
// then the photo in the mask's colours with the collected colours where
// they were held up (left), and each collected colour's recipe (right).
export function ColorSection({ sketch, reference }) {
  const shapes = readMask(sketch.gamut_mask) || []
  const swatches = sketch.gamut_mask?.swatches || []
  const [paints, setPaints] = useState(null)
  const { url } = useMaskedPhoto(reference, shapes)

  // The owner's paints, as on the Color tab; else the starter palette.
  const username = sketch.owner?.username
  useEffect(() => {
    if (!shapes.length && !swatches.length) return
    const fallback = () => setPaints(starterPaints())
    if (!username) return fallback()
    api.get(`/api/sketchers/${username}`)
      .then(({ data }) => {
        const list = kitPaintList(data.favorite_paints || [], data.palette_layout)
        setPaints(list.length ? list : starterPaints())
      })
      .catch(fallback)
  }, [username, shapes.length, swatches.length])

  if (!shapes.length && !swatches.length) return null
  let slot = 0
  return (
    <section className="ed-section">
      <h2 className="ed-kicker m-0">The colour study</h2>
      {shapes.length > 0 && (
        <div className="grid gap-8 md:grid-cols-2 md:gap-14">
          <div className="flex flex-col gap-3">
            <h3 className="m-0 font-sans text-lg font-normal">Gamut mask</h3>
            <div className="bg-black p-4">
              <GamutWheel shapes={shapes} onChange={noop} active={0} onActive={noop} paints={[]} readOnly />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="m-0 font-sans text-lg font-normal">Colour values</h3>
            <div className="bg-black p-4">
              {paints
                ? <MaskValues shapes={shapes} paints={paints} marked={swatches} readOnly />
                : <p className="m-0 animate-pulse text-sm text-sc-text3">Working…</p>}
            </div>
          </div>
        </div>
      )}
      {reference && (
        <div className="grid gap-8 md:grid-cols-2 md:gap-14">
          <div className="relative">
            <img src={url || reference} alt={url ? "The reference photo in the mask's colours" : 'The reference photo'} className="block w-full" />
            <RuleOfThirdsGrid />
            {swatches.map((s) => (
              <span key={s.hex} title={s.hex} className="absolute h-7 w-7 border border-white shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
                style={s.x != null
                  ? { background: s.hex, left: `${s.x * 100}%`, top: `${s.y * 100}%`, transform: 'translate(-50%, -50%)' }
                  : { background: s.hex, right: 8, top: 8 + 34 * slot++ }} />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="m-0 font-sans text-lg font-normal">Selected colours</h3>
            {swatches.length === 0 && <p className="ed-note m-0">No colours collected.</p>}
            {paints && swatches.map((s) => {
              const r = recipeFor({ ...s, from: 'wheel' }, paints)
              return (
                <div key={s.hex} className="flex items-start gap-3 border-b border-ink/10 pb-3">
                  <span className="h-10 w-10 shrink-0 border border-ink/20" style={{ background: s.hex }} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-base text-ink">{r ? recipeLine(r.recipe) : s.hex}</p>
                    {r?.note && <p className="ed-note m-0">{r.note}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
