import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Circle, MapContainer, Marker, TileLayer } from 'react-leaflet'
import Icon from './Icon'
import SketchCard, { RATIOS } from './SketchCard'
import SketchPins from './SketchPins'
import { FitToMarkers, FlyTo, pinIcon } from './LocationMap'
import LocationSearchField from './LocationSearchField'
import { sketchDate } from '../../lib/sketchDate'

/**
 * GRID / MAP tabs over a list of sketches (design handoff,
 * SketchListMapView). Used on the Sketcher page and Sketch Detail, later
 * on Home and search.
 *
 *   items      [{ id, title, meta, date, place, lat, lon, image, multi, href, linkState, sketch }]
 *              sketch: the sketch itself, for SketchCard (status and like)
 *              linkState: router state for the link (e.g. backgroundLocation,
 *              to open Edit Sketch as a modal)
 *   view       'grid' | 'map', the tab it opens on
 *   pinMode    kept for callers; every map now works like Explore's
 *   center     { lat, lon, radius }: "this sketch" dot and a dashed ring
 *              (showCenter in the handoff)
 *   cols       grid columns from 768px (2 on a phone); 3 by default
 *   ratio      the card image: 'square' (default) or 'portrait' (4:5).
 *              The app's standard is the defaults; pass these only to
 *              differ.
 *   onPlaceSelect(place)  (unused on the map since it works like Explore)
 *   searchPlaces          a place search over the map, to move it (Home)
 *
 * Map: the same as Explore's (October 30, 2026): the mouse wheel zooms,
 * each sketch is its sketcher's avatar pin, pins that overlap become a
 * count disc that zooms in on a click, and a pin opens the sketch's card
 * (SketchPins).
 */
const COLS = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' }
const CARD_H = 340 // image 4:5 at 220 px, plus the caption

const stamp = (it) => {
  const t = Date.parse(sketchDate(it.sketch) || '')
  return Number.isNaN(t) ? 0 : t
}

export default function SketchListMapView({
  items: given = [],
  view: initialView = 'grid',
  pinMode = 'sketch',
  center,
  cols = 3,
  ratio = 'square',
  emptyText = 'No sketches yet.',
  onPlaceSelect,
  searchPlaces = false,
}) {
  // Always latest to oldest, by the sketch's date (lib/sketchDate.js),
  // whatever order the page passed in (October 30, 2026).
  const items = useMemo(() => [...given].sort((a, b) => stamp(b) - stamp(a)), [given])
  const [view, setView] = useState(initialView)
  const [focus, setFocus] = useState(null) // a place picked in the search over the map


  const located = items.filter((it) => it.lat != null && it.lon != null)

  // The sketches with a place, for the map's pins.
  const onMap = useMemo(() => located.map((it) => it.sketch && it.sketch.location ? it.sketch
    : { id: it.id, title: it.title, location: { lat: it.lat, lon: it.lon, label: it.place }, final_sketch_url: it.image }), [located])

  return (
    <div className="flex flex-col gap-5">
      <div className="ed-tabs" role="tablist">
        {['grid', 'map'].map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className="ed-tab" onClick={() => setView(v)}>
            {v}
          </button>
        ))}
        <span className="ml-auto pb-2 text-sm text-ink/70">
          {items.length} {items.length === 1 ? 'sketch' : 'sketches'}
        </span>
      </div>

      {items.length === 0 && <p className="text-sm text-ink/50">{emptyText}</p>}

      {items.length > 0 && view === 'grid' && (
        <div className={`grid grid-cols-2 gap-x-4 gap-y-6 md:gap-x-7 md:gap-y-8 ${COLS[cols] || COLS[3]}`}>
          {items.map((it) => it.sketch ? (
            // A sketch: the shared card, with its status and like.
            <SketchCard key={it.id} sketch={it.sketch} meta={it.meta} href={it.href} linkState={it.linkState} image={it.image} multi={it.multi} ratio={ratio} />
          ) : (
            <Link key={it.id} to={it.href || `/sketches/${it.id}`} state={it.linkState} className="group flex flex-col gap-2 text-ink no-underline">
              <span className="ed-slide" style={{ aspectRatio: RATIOS[ratio] || RATIOS.square }}>
                {it.image && <img src={it.image} alt="" loading="lazy" />}
                {it.multi && (
                  <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-ink" aria-label="More than one image">
                    <Icon name="stack" size={15} />
                  </span>
                )}
              </span>
              {it.meta && <span className="ed-caption">{it.meta}</span>}
              <span className="-mt-1 font-heading text-lg font-medium leading-snug group-hover:text-ink/70">{it.title || 'Untitled sketch'}</span>
            </Link>
          ))}
        </div>
      )}

      {items.length > 0 && view === 'map' && (
        <div className="relative">
          {located.length === 0 ? (
            <p className="text-sm text-ink/50">None of these sketches has a location.</p>
          ) : (
            <MapContainer center={[located[0].lat, located[0].lon]} zoom={13} scrollWheelZoom
              className="h-[420px] w-full md:h-[520px]">
              <TileLayer
                attribution='Tiles &copy; Esri &mdash; Sources: Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
              />
              <FitToMarkers markers={located} zoom={14} />
              {focus && <FlyTo focus={focus} />}
              {center && (
                <>
                  <Circle center={[center.lat, center.lon]} radius={center.radius}
                    pathOptions={{ color: '#111111', weight: 1.5, dashArray: '6 6', fillOpacity: 0.04 }} />
                  <Marker position={[center.lat, center.lon]} icon={pinIcon({ variant: 'center' })} zIndexOffset={500} />
                </>
              )}
              <SketchPins sketches={onMap} />
            </MapContainer>
          )}
          {searchPlaces && located.length > 0 && (
            <div className="absolute right-3 top-3 z-[1000] w-[min(320px,calc(100%-24px))] rounded-lg bg-white p-1.5 shadow-lg">
              <LocationSearchField location={focus} onLocationChange={setFocus} />
            </div>
          )}

        </div>
      )}
    </div>
  )
}
