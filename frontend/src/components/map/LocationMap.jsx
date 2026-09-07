import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

// Child of MapContainer only — useMapEvents needs the Leaflet map context,
// which only exists inside <MapContainer>, so this can't be inlined into
// the parent component's own body.
function ClickToSetLocation({ onLocationChange }) {
  useMapEvents({
    click(e) {
      onLocationChange({ lat: e.latlng.lat, lon: e.latlng.lng })
    },
  })
  return null
}

/**
 * "Where this happened" map (design doc, Section 3, "Display, this
 * semester"): react-leaflet + free OpenStreetMap tiles, no paid API key.
 *
 * Two shapes: pass `lat`/`lon` for a single-pin display (a sketch's own
 * location), or `points` (array of {lat, lon, label}) for the Home page's
 * "Map View" of many sketches at once — centered on their average position,
 * which is good enough for a first pass without pulling in a fitBounds hook.
 *
 * Pass `editable` + `onLocationChange` (added for the sketch-edit flow) to
 * let the sketcher click anywhere on the map, or drag the existing pin, to
 * set/adjust the location — every other caller (SketchDetailPage, the Home
 * page's Map View) omits both and keeps the original display-only behavior.
 */
export default function LocationMap({ lat, lon, label, points, zoom = 13, editable = false, onLocationChange, height = 'h-72' }) {
  const markers = points?.length ? points : (lat != null && lon != null ? [{ lat, lon, label }] : [])

  if (markers.length === 0 && !editable) {
    return (
      <div className={`flex ${height} items-center justify-center rounded-lg bg-black/5 text-sm text-ink/50`}>
        No location recorded yet
      </div>
    )
  }

  // No location yet but editable (a fresh sketch with no embedded GPS) —
  // fall back to a wide, neutral world view so there's something to click.
  const center = markers.length > 0
    ? [
        markers.reduce((sum, p) => sum + p.lat, 0) / markers.length,
        markers.reduce((sum, p) => sum + p.lon, 0) / markers.length,
      ]
    : [20, 0]
  const initialZoom = markers.length > 0 ? (markers.length > 1 ? 11 : zoom) : 2

  return (
    <div>
      <MapContainer center={center} zoom={initialZoom} scrollWheelZoom={editable} className={`${height} w-full rounded-lg`}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {editable && <ClickToSetLocation onLocationChange={onLocationChange} />}
        {markers.map((p, i) => (
          <Marker
            key={i}
            position={[p.lat, p.lon]}
            draggable={editable}
            eventHandlers={editable ? {
              dragend: (e) => {
                const { lat: newLat, lng: newLon } = e.target.getLatLng()
                onLocationChange({ lat: newLat, lon: newLon })
              },
            } : undefined}
          >
            {p.label && <Popup>{p.label}</Popup>}
          </Marker>
        ))}
      </MapContainer>
      {editable && (
        <p className="mt-1 text-xs text-ink/50">
          {markers.length > 0 ? 'Click the map or drag the pin to adjust the location.' : "Click the map to set this sketch's location."}
        </p>
      )}
    </div>
  )
}
