import { useMemo, useState } from 'react'
import GamutWheel from './GamutWheel'
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

  return (
    <div className="flex flex-col gap-4">
      <p className="text-md text-sc-text2">
        {readOnly
          ? 'Your gamut mask. It is part of the plan, so it stays as it was when you shared the final sketch.'
          : 'Tap three of your paints to make a mask. Drag a corner to move it, or off the wheel to remove it. Tap inside the mask, or on the photo, to see a mix.'}
      </p>

      <GamutWheel corners={corners} paints={paints} onChange={onChange} onFocus={setFocus} onSample={(w) => onSample({ ...w, from: 'wheel' })}
        sample={sample} readOnly={readOnly} />

      <p className="min-h-5 text-sm text-white">{focusText || ' '}</p>
      {!fromKit && <p className="-mt-2 text-sm text-sc-text3">Showing common paints. Add your own in My kit on your page.</p>}

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
