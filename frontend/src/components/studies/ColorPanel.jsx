import { useMemo, useState } from 'react'
import GamutWheel, { MAX_CORNERS } from './GamutWheel'
import {
  centroid, clampToPolygon, hexToWheel, hueName, isStrong, mixHex, recipeText, toParts, weightsAt, wheelToHex, wheelToXY, xyToWheel,
} from '../../lib/colorWheel'

const UNIT = 2 // the wheel in unit space for the maths: radius 1

// A mix at a wheel point, from the mask's corners: its colour and recipe.
export function mixAt(point, corners, paints) {
  if (!corners.length) return null
  const pts = corners.map((c) => wheelToXY(c, UNIT))
  const p = wheelToXY(point, UNIT)
  const q = clampToPolygon(p, pts)
  const parts = toParts(weightsAt(q, pts))
  const hexes = corners.map((c) => paints.find((x) => x.id === c.paint_id)?.hex || wheelToHex(c))
  const names = corners.map((c) => paints.find((x) => x.id === c.paint_id)?.name || hueName(c))
  return {
    hex: mixHex(parts.map(([k, n]) => [hexes[k], n])),
    text: recipeText(parts, names),
    strong: parts.length > 1 && parts.some(([k]) => isStrong(corners[k].paint_id)),
    outside: Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.01,
  }
}

/**
 * The Color tab's right panel (design doc, item 37): the gamut mask wheel,
 * the touched paint's lean, the mixes inside the mask in parts, and the
 * mix for a spot tapped on the photo or inside the mask.
 *
 *   corners, onChange(corners, { done })   the mask
 *   paints     the sketcher's kit paints (or the starter list)
 *   fromKit    false when `paints` is the starter list
 *   sample     { h, c, from } | null      a spot to mix ('photo' | 'wheel')
 *   onSample   a tap inside the mask
 */
export default function ColorPanel({ corners, onChange, paints, fromKit, sample, onSample, readOnly }) {
  const [focus, setFocus] = useState(null)

  // The mixes along the mask: the middle of each edge, and the centre.
  const mixes = useMemo(() => {
    if (corners.length < 2) return []
    const pts = corners.map((c) => wheelToXY(c, UNIT))
    const spots = []
    const edges = corners.length === 2 ? [[0, 1]] : corners.map((_, i) => [i, (i + 1) % corners.length])
    for (const [a, b] of edges) spots.push([(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2])
    if (corners.length >= 3) spots.push(centroid(pts))
    return spots.map((s) => mixAt(xyToWheel(...s, UNIT), corners, paints))
  }, [corners, paints])

  const sampleMix = sample ? mixAt(sample, corners, paints) : null
  const focusText = focus?.paint
    ? `${focus.paint.name}: ${focus.paint.lean || hueName(hexToWheel(focus.paint.hex))}`
    : focus?.corner ? `A free corner: ${hueName(focus.corner)}` : null

  const inMask = (p) => corners.some((c) => c.paint_id === p.id)
  function togglePaint(p) {
    setFocus({ paint: p })
    if (inMask(p)) return onChange(corners.filter((c) => c.paint_id !== p.id), { done: true })
    if (corners.length >= MAX_CORNERS) return
    const w = hexToWheel(p.hex)
    onChange([...corners, { h: w.h, c: w.c, paint_id: p.id }], { done: true })
  }
  const removeCorner = (i) => onChange(corners.filter((_, j) => j !== i), { done: true })
  const freeCorners = corners.map((c, i) => [c, i]).filter(([c]) => !c.paint_id)
  const left = Math.max(0, 3 - corners.length)
  const step = readOnly
    ? 'Your gamut mask. It is part of the plan, so it stays as it was when you shared the final sketch.'
    : corners.length === 0
      ? 'Pick 3 paints from your palette below. They become the corners of your mask.'
      : left > 0
        ? `Pick ${left} more ${left === 1 ? 'paint' : 'paints'}.`
        : 'The colours inside the mask are the mixes these paints make. Tap inside it, or on the photo, to see a mix.'

  return (
    <div className="flex flex-col gap-4">
      <p className="text-md text-white">{step}</p>

      <GamutWheel corners={corners} paints={paints} onChange={onChange} onFocus={setFocus} onSample={(w) => onSample({ ...w, from: 'wheel' })}
        sample={sample} readOnly={readOnly} />

      <p className="min-h-5 text-sm text-sc-text2">{focusText || '\u00a0'}</p>

      {/* The palette: the main way to pick the mask. */}
      <div className="flex flex-col gap-2">
        <span className="sc-field-label">{fromKit ? 'Your palette' : 'Common paints'} · {corners.length} in the mask</span>
        <div className="flex flex-wrap gap-2">
          {paints.map((p) => {
            const on = inMask(p)
            return (
              <button key={p.id} type="button" disabled={readOnly || (!on && corners.length >= MAX_CORNERS)} aria-pressed={on}
                onClick={() => togglePaint(p)}
                className={`flex min-h-11 items-center gap-2 rounded-full border-[1.5px] py-1 pl-1.5 pr-3 text-sm font-semibold transition-colors disabled:opacity-40 ${
                  on ? 'border-white bg-sc-guide text-white' : 'border-sc-border bg-sc-raised text-white hover:border-sc-strong'
                }`}>
                <span className="h-7 w-7 shrink-0 rounded-full border border-white/40" style={{ background: p.hex }} />
                {p.name}
              </button>
            )
          })}
          {freeCorners.map(([c, i]) => (
            <span key={`free-${i}`} className="flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-white bg-sc-guide py-1 pl-1.5 pr-1 text-sm font-semibold text-white">
              <span className="h-7 w-7 shrink-0 rounded-full border border-white/40" style={{ background: `hsl(${c.h} ${Math.round(c.c * 100)}% 50%)` }} />
              Free colour: {hueName(c)}
              {!readOnly && (
                <button type="button" onClick={() => removeCorner(i)} aria-label="Take this colour out of the mask"
                  className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10">×</button>
              )}
            </span>
          ))}
        </div>
        {!fromKit && <p className="text-sm text-sc-text3">Add your own paints in My kit on your page.</p>}
        {!readOnly && corners.length >= 3 && (
          <p className="text-sm text-sc-text3">To try a colour you don't own, drag a corner to another cell. Drag it off the wheel to take it out.</p>
        )}
      </div>

      {sampleMix && (
        <div className="flex items-start gap-3 rounded-xl border border-sc-border p-3">
          <span className="h-11 w-11 shrink-0 rounded-lg border border-white/20" style={{ background: sampleMix.hex }} />
          <span className="flex flex-col gap-0.5 text-sm">
            <span className="font-bold text-white">{sample.from === 'photo' ? 'This spot in the photo' : 'This mix'}</span>
            {sampleMix.outside && <span className="text-sc-text3">Outside your mask. The nearest mix:</span>}
            <span className="text-sc-text2">{sampleMix.text}</span>
          </span>
        </div>
      )}

      {mixes.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="sc-field-label">Mixes in your mask</span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {mixes.map((m, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="h-9 w-9 shrink-0 rounded-md border border-white/20" style={{ background: m.hex }} />
                <span className="text-sm text-sc-text2">
                  {m.text}
                  {m.strong && <span className="block text-sc-text3">Add the strong one a little at a time.</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-sc-text3">Parts are a starting point. Mix by eye.</p>
        </div>
      )}
    </div>
  )
}
