import { useEffect, useState } from 'react'
import GamutWheel from '../analysis/GamutWheel'
import RuleOfThirdsGrid from '../analysis/RuleOfThirdsGrid'
import { readMask } from '../../lib/gamutMask'
import { api } from '../../lib/api'

const noop = () => {}

/**
 * SketchDetail's value and colour plan (design doc, item 37), from the Edit
 * Sketch Value and Color tabs. Each half shows only when the sketcher used
 * that tab; with neither, nothing shows.
 *   Values  the photo in the chosen number of values
 *   Colour  the gamut mask on the wheel, and the collected colours where
 *           the sketcher held them up to the photo
 */
export default function StudiesSection({ sketch, reference }) {
  const levels = sketch.value_levels
  const shapes = readMask(sketch.gamut_mask) || []
  const swatches = sketch.gamut_mask?.swatches || []
  const hasColor = shapes.length > 0 || swatches.length > 0
  const [study, setStudy] = useState(null) // null loading, false failed

  useEffect(() => {
    if (!levels) return
    setStudy(null)
    api.get(`/api/sketches/${sketch.id}/value-study`, { params: { levels, scale: true } })
      .then(({ data }) => setStudy(data))
      .catch(() => setStudy(false))
  }, [sketch.id, levels])

  if (!levels && !hasColor) return null
  let slot = 0
  return (
    <section className="ed-section">
      <h2 className="ed-kicker m-0">Values and colour</h2>
      <div className="grid gap-8 md:grid-cols-2 md:gap-14">
        {levels && (
          <div className="flex flex-col gap-3">
            <h3 className="m-0 font-sans text-lg font-normal">{levels} values</h3>
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
          </div>
        )}
        {hasColor && (
          <div className="flex flex-col gap-3">
            <h3 className="m-0 font-sans text-lg font-normal">{shapes.length ? 'Gamut mask' : 'Colours'}</h3>
            {shapes.length > 0 && (
              <div className="bg-black p-4">
                <GamutWheel shapes={shapes} onChange={noop} active={0} onActive={noop} paints={[]} readOnly className="max-w-[300px]" />
              </div>
            )}
            {swatches.length > 0 && reference && (
              // The collected colours where the sketcher held them up to the
              // photo; the rest stack in the corner.
              <div className="relative">
                <img src={reference} alt="The reference photo with the collected colours" className="block w-full" />
                {swatches.map((s) => (
                  <span key={s.hex} title={s.hex} className="absolute h-7 w-7 border border-white shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
                    style={s.x != null
                      ? { background: s.hex, left: `${s.x * 100}%`, top: `${s.y * 100}%`, transform: 'translate(-50%, -50%)' }
                      : { background: s.hex, right: 8, top: 8 + 34 * slot++ }} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
