import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import BasePage from '../components/common/BasePage'
import LocationSearchField from '../components/common/LocationSearchField'
import SketchCard from '../components/common/SketchCard'
import { pinIcon } from '../components/common/LocationMap'
import { api } from '../lib/api'

// The time filter, in place of Google Maps' category pills.
const PERIODS = [
  { key: '3m', label: 'Past 3 months', days: 92 },
  { key: '1y', label: 'Past year', days: 365 },
  { key: 'all', label: 'All', days: null },
]
const RED_PIN = pinIcon({ variant: 'pin', active: true })
const PICKED_PIN = pinIcon({ variant: 'pin', active: true, big: true }) // the card picked in the list
const NEAR_ZOOM = 13
const GROUP_PX = 36 // pins closer than this on screen become one count disc

// Starts at the sketcher's location when the browser gives it.
function StartAtMe({ onReady }) {
  const map = useMap()
  useEffect(() => {
    if (!navigator.geolocation) return onReady()
    navigator.geolocation.getCurrentPosition(
      (pos) => { map.setView([pos.coords.latitude, pos.coords.longitude], NEAR_ZOOM); onReady() },
      () => onReady(),
      { timeout: 8000, maximumAge: 600000 },
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// The map's view, whenever it stops moving.
function ViewWatcher({ onView }) {
  // Only the part of the map beside the panel counts as "in view".
  const visible = () => {
    const size = map.getSize()
    const x = Math.min(panelInset(), size.x - 1)
    return L.latLngBounds(map.containerPointToLatLng([x, 0]), map.containerPointToLatLng([size.x, size.y]))
  }
  const map = useMapEvents({ moveend: () => onView(visible()), resize: () => onView(visible()) })
  useEffect(() => { onView(visible()) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// The floating panel covers the left of the map on a computer: what the map
// fits or centres goes in the part that shows (on a phone the panel sits on
// top, and the whole width shows).
const PANEL_PX = 384
const panelInset = () => (window.innerWidth >= 768 ? PANEL_PX : 0)
const fitOptions = (extra = {}) => ({ paddingTopLeft: [panelInset() + 24, 24], paddingBottomRight: [24, 24], ...extra })

// A searched place: the whole of it in view (a city, a district), else
// close around its point.
function FlyTo({ place }) {
  const map = useMap()
  useEffect(() => {
    if (!place) return
    if (place.bbox) {
      const [s, n, w, e] = place.bbox
      map.flyToBounds([[s, w], [n, e]], fitOptions({ maxZoom: 15, duration: 0.8 }))
    } else {
      // The point in the middle of the part of the map that shows.
      const pt = map.project([place.lat, place.lon], NEAR_ZOOM).subtract([panelInset() / 2, 0])
      map.flyTo(map.unproject(pt, NEAR_ZOOM), NEAR_ZOOM, { duration: 0.8 })
    }
  }, [place?.lat, place?.lon]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// The pins at the map's zoom: sketches that would sit on top of each other
// (a city seen from a country's zoom) become one count disc, the same disc
// as SketchListMapView's; a click on it zooms in until they separate.
function Pins({ pins, picked }) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const groups = useMemo(() => {
    const out = []
    for (const s of pins) {
      const pt = map.project([s.location.lat, s.location.lon], zoom)
      // The picked sketch always keeps its own pin, never inside a disc.
      const g = s.id === picked ? null : out.find((x) => !x.picked && x.pt.distanceTo(pt) < GROUP_PX)
      if (g) g.items.push(s)
      else if (s.id === picked) out.push({ pt, items: [s], picked: true })
      else out.push({ pt, items: [s] })
    }
    return out
  }, [pins, zoom, map, picked])
  return groups.map((g) => {
    if (g.items.length === 1) {
      const s = g.items[0]
      return (
        <Marker key={s.id} position={[s.location.lat, s.location.lon]} icon={picked === s.id ? PICKED_PIN : RED_PIN} zIndexOffset={picked === s.id ? 1000 : 0}>
          <Popup minWidth={240} maxWidth={260} className="explore-popup">
            <SketchCard sketch={s} details />
          </Popup>
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
            fitOptions({ maxZoom: 18, duration: 0.6 })),
        }} />
    )
  })
}

/**
 * Explore (design doc, Search): the whole page is the map. A floating panel
 * in the top left searches for a place; the time filter sits beside it.
 * Opens at the sketcher's location, showing shared sketches made nearby in
 * the past 3 months. Each sketch is a red pin; a pin opens its SketchCard.
 */
export default function Explore() {
  const [place, setPlace] = useState(null)
  // The time filter is set aside for now (all dates): it comes back as a
  // filter panel once there are enough sketches to need it.
  const [period, setPeriod] = useState('all')
  const [topPlaces, setTopPlaces] = useState([]) // the most sketched cities, as pills
  const [bounds, setBounds] = useState(null)
  const [located, setLocated] = useState(false) // the start position is settled
  const [sketches, setSketches] = useState([])
  const [loading, setLoading] = useState(false)
  const [map, setMap] = useState(null)
  const [picked, setPicked] = useState(null) // the sketch picked in the list
  const timer = useRef(null)

  // A card in the list: its pin to the centre of the map, at the same zoom.
  function centreOn(s) {
    setPicked(s.id)
    if (!map || !s.location) return
    const pt = map.project([s.location.lat, s.location.lon]).subtract([panelInset() / 2, 0])
    map.panTo(map.unproject(pt), { animate: true })
  }

  // Sketches in view, a moment after the map stops or the filter changes.
  useEffect(() => {
    if (!bounds || !located) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const days = PERIODS.find((p) => p.key === period).days
      setLoading(true)
      api.get('/api/sketches/explore', {
        params: {
          south: Math.max(-90, bounds.getSouth()), north: Math.min(90, bounds.getNorth()),
          west: Math.max(-180, bounds.getWest()), east: Math.min(180, bounds.getEast()),
          ...(days ? { since_days: days } : {}),
        },
      })
        .then(({ data }) => setSketches(data))
        .catch(() => setSketches([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(timer.current)
  }, [bounds, period, located])

  useEffect(() => {
    api.get('/api/explore/places').then(({ data }) => setTopPlaces(data)).catch(() => setTopPlaces([]))
  }, [])

  const pins = useMemo(() => sketches.filter((s) => s.location), [sketches])

  const pills = (
    <div className="flex gap-2 overflow-x-auto" role="radiogroup" aria-label="When">
      {PERIODS.map((p) => (
        <button key={p.key} type="button" role="radio" aria-checked={period === p.key} onClick={() => setPeriod(p.key)}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold shadow-md transition-colors ${
            period === p.key ? 'border-ink bg-ink text-white' : 'border-black/10 bg-white text-ink hover:bg-black/5'
          }`}>
          {p.label}
        </button>
      ))}
    </div>
  )

  return (
    <BasePage fullBleed className="">
        <MapContainer ref={setMap} center={[20, 0]} zoom={2} zoomControl={false} scrollWheelZoom className="absolute inset-0 h-full w-full">
          <TileLayer
            attribution='Tiles &copy; Esri &mdash; Sources: Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
          />
          <ZoomControl position="bottomright" />
          <StartAtMe onReady={() => setLocated(true)} />
          <ViewWatcher onView={setBounds} />
          <FlyTo place={place} />
          <Pins pins={pins} picked={picked} />
        </MapContainer>

        {/* The floating panel: the place search, and the time filter on a phone. */}
        <div className="absolute bottom-3 left-3 top-3 z-[1000] flex w-[min(360px,calc(100%-24px))] flex-col gap-2 pointer-events-none max-md:bottom-auto">
          <div className="pointer-events-auto flex min-h-0 flex-col rounded-xl bg-white p-2 shadow-lg">
            <LocationSearchField location={place} onLocationChange={setPlace} withBounds />
            {/* The most sketched places: a tap takes the map there. */}
            {topPlaces.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-1 pt-2">
                {topPlaces.map((t) => (
                  <button key={t.label} type="button" onClick={() => setPlace({ label: t.label, lat: t.lat, lon: t.lon, bbox: t.bbox })}
                    aria-pressed={place?.label === t.label}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      place?.label === t.label ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white text-ink hover:border-ink'
                    }`}>
                    {t.label} <span className="font-normal opacity-60">{t.count}</span>
                  </button>
                ))}
              </div>
            )}
            <p className={`m-0 px-1 pt-1.5 text-xs text-ink/60 ${loading ? 'animate-pulse' : ''}`}>
              {loading ? 'Finding sketches…' : `${pins.length} ${pins.length === 1 ? 'sketch' : 'sketches'} in view`}
            </p>
            {/* None in view within the time filter: offer every date. */}
            {!loading && pins.length === 0 && period !== 'all' && (
              <p className="m-0 px-1 pt-1 text-xs text-ink/60">
                None from the {PERIODS.find((p) => p.key === period).label.toLowerCase()}.{' '}
                <button type="button" className="font-semibold text-ink underline" onClick={() => setPeriod('all')}>Show all dates</button>
              </p>
            )}
            {/* The sketches in view, one under another; a card moves the map to it. */}
            {pins.length > 0 && (
              <ul className="m-0 mt-2 flex min-h-0 list-none flex-col gap-4 overflow-y-auto p-1 max-md:max-h-[38vh]">
                {pins.map((s) => (
                  <li key={s.id} className={`rounded-lg p-1 ${picked === s.id ? 'outline outline-2 outline-ink' : ''}`}>
                    <SketchCard sketch={s} details onSelect={centreOn} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* The time filter, set aside for now (see `period`):
          <div className="md:hidden">{pills}</div> */}
        </div>
        {/* <div className="absolute left-[388px] top-3 z-[1000] hidden md:block">{pills}</div> */}
    </BasePage>
  )
}
