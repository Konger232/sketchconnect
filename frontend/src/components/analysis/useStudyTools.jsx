import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { DEFAULT_SHAPES, readMask } from '../../lib/gamutMask'
import { kitPaintList, starterPaints } from '../../data/paints'
import { StripImage } from './StageStrip'
import { MaskedPhoto, SamplePhoto } from './ColorStage'
import SwatchOverlay from './SwatchOverlay'
import RecipeStrip from './RecipeStrip'

/**
 * The Value and Color tools (design doc, item 37): their state, saving and
 * photo panels. Moved from Edit Sketch so Edit Sketch and Capture share
 * them (item 57). ValuePanel and ColorPanel draw the right panel; panels()
 * gives the photo stage (StageStrip). Neither tool changes the plan, the
 * tips or the feedback.
 *
 * sketch: the loaded sketch (its value_levels and gamut_mask), or null.
 * active: the tool is open, so its data loads. enabled: the owner edits.
 * photoKey: changes when the framed photo changes, so the values are read
 * again.
 */

export function useValueTool({ sketchId, sketch, active, enabled, photoKey }) {
  const [levels, setLevels] = useState(5)
  const [studies, setStudies] = useState({}) // { levels: study }
  const [error, setError] = useState(null)

  useEffect(() => {
    if (sketch?.value_levels) setLevels(sketch.value_levels)
  }, [sketch?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setStudies({}) }, [photoKey])

  // The value study for the picked number of values, fetched once each.
  useEffect(() => {
    if (!active || !enabled || !sketchId || studies[levels]) return
    setError(null)
    api.get(`/api/sketches/${sketchId}/value-study`, { params: { levels, scale: true } })
      .then(({ data }) => setStudies((m) => ({ ...m, [levels]: data })))
      .catch(() => setError('Could not read the values right now.'))
  }, [active, levels, enabled, sketchId, studies]) // eslint-disable-line react-hooks/exhaustive-deps

  function pick(n) {
    setLevels(n)
    api.put(`/api/sketches/${sketchId}/studies`, { value_levels: n }).catch(() => {})
  }

  const study = studies[levels]
  const panels = (photo) => [
    { key: 'values', label: `${levels} values`, content: study
      ? <StripImage src={study.valueStudyImage} alt={`The photo in ${levels} values`} grid />
      : <div className="flex min-h-[40vh] flex-1 animate-pulse items-center justify-center text-md text-sc-text3">Reading the values…</div> },
    { key: 'photo', label: 'Reference photo', content: <StripImage src={photo} alt="Reference photo" grid /> },
  ]
  return { levels, pick, study, error, panels }
}

export function useColorTool({ sketchId, sketch, enabled }) {
  const [shapes, setShapes] = useState(DEFAULT_SHAPES)
  const [sample, setSample] = useState(null)
  const [swatches, setSwatches] = useState([]) // tiles collected from the wheel: [{ h, c, hex }]
  const [kitPaints, setKitPaints] = useState(null) // null until loaded
  const saveRef = useRef(null)
  // The mix: the kit's paints and the favourite palette, else the starter list.
  const paints = useMemo(() => (kitPaints?.length ? kitPaints : starterPaints()), [kitPaints])

  useEffect(() => {
    if (!sketch) return
    setShapes(readMask(sketch.gamut_mask) || DEFAULT_SHAPES)
    setSwatches(sketch.gamut_mask?.swatches || [])
  }, [sketch?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Loaded as soon as the sketch opens, not when Color does: the wheel
    // waited about 2 seconds for it (November 27, 2026).
    if (kitPaints || !enabled) return
    api.get('/api/profile').catch(() => ({ data: {} }))
      .then((prof) => setKitPaints(kitPaintList(prof.data.favorite_paints || [], prof.data.palette_layout)))
  }, [kitPaints, enabled])

  // The mask saves itself a moment after a change ends.
  function save(nextShapes, sw) {
    clearTimeout(saveRef.current)
    saveRef.current = setTimeout(() => {
      api.put(`/api/sketches/${sketchId}/studies`, { gamut_mask: { shapes: nextShapes, swatches: sw } }).catch(() => {})
    }, 400)
  }
  function changeMask(next, { done } = {}) {
    setShapes(next)
    if (done) save(next, swatches)
    else clearTimeout(saveRef.current)
  }
  function dropSwatch(hex) {
    const next = swatches.filter((s) => s.hex !== hex)
    setSwatches(next)
    if (sample?.hex === hex) setSample(null)
    save(shapes, next)
  }
  // A tile tapped on the wheel toggles: collected into "Your colours" and
  // shown, or, when already collected, taken out.
  function pickTile(sel) {
    if (swatches.some((s) => s.hex === sel.hex)) { dropSwatch(sel.hex); return }
    setSample(sel)
    const next = [...swatches, { h: sel.h, c: sel.c, hex: sel.hex }].slice(-16)
    setSwatches(next)
    save(shapes, next)
  }
  // A swatch dragged onto the photo: its place (0 to 1, from the top left)
  // is kept for the critique.
  function placeSwatch(hex, { x, y }) {
    const next = swatches.map((s) => (s.hex === hex ? { ...s, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } : s))
    setSwatches(next)
    save(shapes, next)
  }

  // Over the photo: the recipe strip at the bottom, the swatches above it.
  const overlay = (
    <>
      <RecipeStrip selected={sample} paints={paints} onClose={() => setSample(null)} />
      <SwatchOverlay swatches={swatches} selected={sample} onSelect={setSample}
        onPlace={placeSwatch} onRemove={(hex) => dropSwatch(hex)} />
    </>
  )
  const panels = (photo) => [
    { key: 'mask', label: 'In your mask', content: (
      <div className="flex min-h-0 flex-1 flex-col">
        <MaskedPhoto src={photo} shapes={shapes} overlay={overlay} />
      </div>
    ) },
    { key: 'sample', label: 'Photo', content: (
      <div className="flex min-h-0 flex-1 flex-col">
        <SamplePhoto src={photo} onSample={setSample} overlay={overlay} />
      </div>
    ) },
  ]
  // ColorPanel's props, but readOnly.
  const panelProps = {
    shapes, onChange: changeMask, paints, fromKit: Boolean(kitPaints?.length), selected: sample, onSelect: setSample,
    onPickTile: pickTile, marked: swatches, onRemoveSwatch: () => dropSwatch(sample?.hex),
    isSwatch: sample?.from === 'wheel' && swatches.some((s) => s.hex === sample.hex),
  }
  return { loaded: kitPaints !== null, panelProps, panels }
}
