import { useMemo, useState } from 'react'
import GamutWheel, { DEFAULT_MASK, MAX_CORNERS } from './GamutWheel'
import {
  centroid, clampToPolygon, hexToWheel, isStrong, maskSize, mixHex, pointInPolygon, recipeText, resizeMask, toParts, weightsAt, wheelToXY, xyToWheel,
} from '../../lib/colorWheel'

const UNIT = 2 // the wheel in unit space for the maths: radius 1
const SIZE_MIN = 0.06 // the mask size slider: mean corner distance from its centre
const SIZE_MAX = 0.9

// The paint closest to a wheel point: the paint a corner stands for.
export function nearestPaint(point, paints) {
  const p = wheelToXY(point, UNIT)
  let best = null, bd = Infinity
  for (const paint of paints) {
    const q = wheelToXY(hexToWheel(paint.hex), UNIT)
    const d = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (d < bd) { bd = d; best = paint }
  }
  return best
}

// A corner's paint: the one it sits on, else the closest.
const cornerPaint = (c, paints) => paints.find((x) => x.id === c.paint_id) || nearestPaint(c, paints)

// A mix at a wheel point, from the mask's corners: its colour and recipe.
export function mixAt(point, corners, paints) {
  if (corners.length < 3 || !paints.length) return null
  const pts = corners.map((c) => wheelToXY(c, UNIT))
  const p = wheelToXY(point, UNIT)
  const q = clampToPolygon(p, pts)
  const parts = toParts(weightsAt(q, pts))
  const cp = corners.map((c) => cornerPaint(c, paints))
  // Two corners on the same paint count once.
  const merged = []
  for (const [k, n] of parts) {
    const found = merged.find(([j]) => cp[j].id === cp[k].id)
    if (found) found[1] += n
    else merged.push([k, n])
  }
  return {
    hex: mixHex(merged.map(([k, n]) => [cp[k].hex, n])),
    text: recipeText(merged, cp.map((x) => x.name)),
    strong: merged.length > 1 && merged.some(([k]) => isStrong(cp[k].id)),
    outside: Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.01,
  }
}

/**
 * The Color tab's right panel (design doc, item 37): the gamut mask, as
 * Gurney uses it. A triangle starts in the middle of the wheel; the
 * sketcher drags its corners to shape it, and adds corners for other
 * shapes. Each corner stands for the paint closest to it, so the mixes
 * come in parts of real paints. Below: the paints inside the mask, and
 * the mix at a spot tapped inside the mask or on the photo.
 *
 *   corners, onChange(corners, { done })   the mask ([] = not made yet)
 *   paints     the sketcher's kit paints (or the starter list)
 *   fromKit    false when `paints` is the starter list
 *   sample     { h, c, from } | null      a spot to mix ('photo' | 'wheel')
 */
export default function ColorPanel({ corners: saved, onChange, paints, fromKit, sample, onSample, readOnly }) {
  const [, setFocus] = useState(null)
  // Until the sketcher shapes it, the mask is the starting triangle.
  const corners = saved.length >= 3 ? saved : DEFAULT_MASK
  const pts = corners.map((c) => wheelToXY(c, UNIT))
  const size = maskSize(corners)

  // Add a corner in the middle of the longest edge, to drag out from there.
  function addCorner() {
    if (corners.length >= MAX_CORNERS) return
    let best = 0, bl = -1
    pts.forEach((q, i) => {
      const r = pts[(i + 1) % pts.length]
      const l = Math.hypot(r[0] - q[0], r[1] - q[1])
      if (l > bl) { bl = l; best = i }
    })
    const a = pts[best], b = pts[(best + 1) % pts.length]
    const mid = xyToWheel((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, UNIT)
    const next = [...corners]
    next.splice(best + 1, 0, { h: mid.h, c: mid.c, paint_id: null })
    onChange(next, { done: true })
  }

  const cornerPaints = corners.map((c) => cornerPaint(c, paints))
  const inside = paints.filter((p) => pointInPolygon(wheelToXY(hexToWheel(p.hex), UNIT), pts))

  // The mixes along the mask: the middle of each edge, and the centre.
  const mixes = useMemo(() => {
    const spots = corners.map((_, i) => {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    })
    spots.push(centroid(pts))
    return spots.map((s) => mixAt(xyToWheel(...s, UNIT), corners, paints)).filter(Boolean)
  }, [corners, paints]) // eslint-disable-line react-hooks/exhaustive-deps

  const sampleMix = sample ? mixAt(sample, corners, paints) : null

  return (
    <div className="flex flex-col gap-4">
      <p className="text-md text-white">
        {readOnly
          ? 'Your gamut mask. It is part of the plan, so it stays as it was when you shared the final sketch.'
          : 'Drag a corner to reshape your mask, or drag inside it to move it. The colours inside are the ones you will mix. Click inside it, or on the photo, to see a mix.'}
      </p>

      <GamutWheel corners={corners} paints={paints} onChange={onChange} onFocus={setFocus}
        onSample={(w) => onSample({ ...w, from: 'wheel' })} sample={sample} readOnly={readOnly} />

      {!readOnly && (
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-sm font-semibold text-white">Mask size</span>
          <button type="button" aria-label="Smaller mask" onClick={() => onChange(resizeMask(corners, Math.max(SIZE_MIN, size - 0.05)), { done: true })}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white hover:bg-white/10">−</button>
          <input type="range" min={SIZE_MIN} max={SIZE_MAX} step={0.01} value={Math.min(SIZE_MAX, size)} aria-label="Mask size"
            onChange={(e) => onChange(resizeMask(corners, Number(e.target.value)), { done: true })}
            className="h-1.5 min-w-0 flex-1 accent-sc-guide" />
          <button type="button" aria-label="Bigger mask" onClick={() => onChange(resizeMask(corners, Math.min(SIZE_MAX, size + 0.05)), { done: true })}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white hover:bg-white/10">+</button>
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={addCorner} disabled={corners.length >= MAX_CORNERS}
            className="flex h-11 items-center rounded-full border-[1.5px] border-sc-border bg-sc-raised px-4 text-sm font-bold text-white hover:border-sc-strong disabled:opacity-40">
            + Add a corner
          </button>
          <button type="button" onClick={() => onChange(DEFAULT_MASK, { done: true })}
            className="flex h-11 items-center rounded-full px-3 text-sm font-semibold text-sc-text2 hover:text-white">
            Reset
          </button>
          <span className="text-sm text-sc-text3">{corners.length > 3 ? 'Drag a corner off the wheel to remove it.' : `Up to ${MAX_CORNERS} corners.`}</span>
        </div>
      )}

      {/* Each corner, as the paint closest to it. */}
      <div className="flex flex-col gap-2">
        <span className="sc-field-label">Corners · the closest {fromKit ? 'paint in your palette' : 'common paint'}</span>
        <div className="flex flex-wrap gap-2">
          {cornerPaints.map((p, i) => (
            <span key={i} className="flex min-h-9 items-center gap-2 rounded-full border border-sc-border py-1 pl-1.5 pr-3 text-sm text-white">
              <span className="h-6 w-6 shrink-0 border border-white" style={{ background: p.hex }} />
              {p.name}
            </span>
          ))}
        </div>
        {inside.length > 0 && (
          <p className="text-sm text-sc-text2">Inside the mask: {inside.map((p) => p.name).join(', ')}.</p>
        )}
        {!fromKit && <p className="text-sm text-sc-text3">Add your own paints in My kit on your page.</p>}
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
