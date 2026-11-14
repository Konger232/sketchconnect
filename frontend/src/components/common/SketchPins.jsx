import { useEffect, useMemo, useState } from 'react'
import { Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import SketchCard from './SketchCard'
import SketchSheet from './SketchSheet'
import { pinIcon } from './LocationMap'
import { imageUrl } from '../../lib/media'
import smiley from '../../assets/images/ico-profile.png'

/**
 * Sketches on a map, the same on every map (October 30, 2026): Explore,
 * the Sketcher page's Map tab, the logged-out Home and a sketch's Nearby.
 *
 * Each sketch is its sketcher's avatar pin (a dashed grey ring while not
 * finished). Pins that would sit on top of each other at this zoom become
 * one count disc; a click on the disc zooms in until they separate. A click
 * on a pin opens its card (SketchCard with details): in a popup on a
 * computer, in a bottom sheet on a phone (SketchSheet), where a popup was
 * cut off by the map's edges (November 14, 2026).
 *
 *   sketches  sketches with location { lat, lon } (and owner, for the avatar)
 *   picked    the id drawn big (Explore's list)
 *   fit       options for the zoom-in (Explore keeps clear of its panel)
 */
export const avatarPin = (s, big) => {
  const url = s.owner?.avatar_url
  return pinIcon({ variant: 'avatar', src: url ? imageUrl(url) : smiley, fallback: !url, big, draft: !s.final_sketch_url })
}
const GROUP_PX = 44 // avatar pins closer than this on screen become one count disc
const defaultFit = (extra = {}) => ({ padding: [30, 30], ...extra })
const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767.98px)').matches

export default function SketchPins({ sketches, picked = null, fit = defaultFit }) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  // Regroup at the zoom the map settles on: after a zoom, and after a fit
  // or fly that may not report one (the map fitting its pins on load).
  const sync = () => setZoom(map.getZoom())
  const [sheet, setSheet] = useState(null) // the sketch in the phone's bottom sheet
  useMapEvents({ zoomend: sync, moveend: sync, viewreset: sync, click: () => setSheet(null) })
  useEffect(() => { const t = setTimeout(sync, 0); return () => clearTimeout(t) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const out = []
    for (const s of sketches) {
      const pt = map.project([s.location.lat, s.location.lon], zoom)
      // The picked sketch always keeps its own pin, never inside a disc.
      const g = s.id === picked ? null : out.find((x) => !x.picked && x.pt.distanceTo(pt) < GROUP_PX)
      if (g) g.items.push(s)
      else if (s.id === picked) out.push({ pt, items: [s], picked: true })
      else out.push({ pt, items: [s] })
    }
    return out
  }, [sketches, zoom, map, picked])
  const phone = isPhone()
  const pins = groups.map((g) => {
    if (g.items.length === 1) {
      const s = g.items[0]
      return (
        <Marker key={s.id} position={[s.location.lat, s.location.lon]} icon={avatarPin(s, picked === s.id || sheet?.id === s.id)}
          zIndexOffset={picked === s.id || sheet?.id === s.id ? 1000 : 0}
          eventHandlers={phone ? { click: () => setSheet(s) } : undefined}>
          {!phone && (
            <Popup minWidth={240} maxWidth={260} className="explore-popup">
              <SketchCard sketch={s} details />
            </Popup>
          )}
        </Marker>
      )
    }
    const lats = g.items.map((s) => s.location.lat), lons = g.items.map((s) => s.location.lon)
    const centre = [lats.reduce((a, b) => a + b) / lats.length, lons.reduce((a, b) => a + b) / lons.length]
    return (
      <Marker key={g.items.map((s) => s.id).join('-')} position={centre}
        icon={pinIcon({ variant: 'count', count: g.items.length, active: true })}
        eventHandlers={{
          click: () => map.flyToBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]],
            fit({ maxZoom: 18, duration: 0.6 })),
        }} />
    )
  })
  return (
    <>
      {pins}
      {sheet && <SketchSheet key={sheet.id} sketch={sheet} onClose={() => setSheet(null)} />}
    </>
  )
}
