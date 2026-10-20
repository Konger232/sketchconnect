import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import Header from '../components/common/Header'
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
const NEAR_ZOOM = 13

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
  const map = useMapEvents({ moveend: () => onView(map.getBounds()) })
  useEffect(() => { onView(map.getBounds()) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function FlyTo({ place }) {
  const map = useMap()
  useEffect(() => { if (place) map.flyTo([place.lat, place.lon], NEAR_ZOOM, { duration: 0.8 }) }, [place?.lat, place?.lon]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/**
 * Explore (design doc, Search): the whole page is the map. A floating panel
 * in the top left searches for a place; the time filter sits beside it.
 * Opens at the sketcher's location, showing shared sketches made nearby in
 * the past 3 months. Each sketch is a red pin; a pin opens its SketchCard.
 */
export default function Explore() {
  const [place, setPlace] = useState(null)
  const [period, setPeriod] = useState('3m')
  const [bounds, setBounds] = useState(null)
  const [located, setLocated] = useState(false) // the start position is settled
  const [sketches, setSketches] = useState([])
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)

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
    <div className="flex h-[100dvh] flex-col">
      <Header />
      <main className="relative min-h-0 flex-1">
        <MapContainer center={[20, 0]} zoom={2} zoomControl={false} scrollWheelZoom className="absolute inset-0 h-full w-full">
          <TileLayer
            attribution='Tiles &copy; Esri &mdash; Sources: Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
          />
          <ZoomControl position="bottomright" />
          <StartAtMe onReady={() => setLocated(true)} />
          <ViewWatcher onView={setBounds} />
          <FlyTo place={place} />
          {pins.map((s) => (
            <Marker key={s.id} position={[s.location.lat, s.location.lon]} icon={RED_PIN}>
              <Popup minWidth={240} maxWidth={260} className="explore-popup">
                <SketchCard sketch={s} details />
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* The floating panel: the place search, and the time filter on a phone. */}
        <div className="absolute left-3 top-3 z-[1000] flex w-[min(360px,calc(100%-24px))] flex-col gap-2">
          <div className="rounded-xl bg-white p-2 shadow-lg">
            <LocationSearchField location={place} onLocationChange={setPlace} />
            <p className={`m-0 px-1 pt-1.5 text-xs text-ink/60 ${loading ? 'animate-pulse' : ''}`}>
              {loading ? 'Finding sketches…' : `${pins.length} ${pins.length === 1 ? 'sketch' : 'sketches'} in view`}
            </p>
          </div>
          <div className="md:hidden">{pills}</div>
        </div>
        <div className="absolute left-[388px] top-3 z-[1000] hidden md:block">{pills}</div>
      </main>
    </div>
  )
}
