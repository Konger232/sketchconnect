import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
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

// Fits the view to every marker (or centres on a single one). Needed
// because MapContainer's center/zoom props are only read once, on mount.
function FitToMarkers({ markers, zoom }) {
  const map = useMap()
  const key = markers.map((p) => `${p.lat},${p.lon}`).join('|')
  useEffect(() => {
    if (markers.length === 0) return
    if (markers.length === 1) {
      map.setView([markers[0].lat, markers[0].lon], zoom)
    } else {
      map.fitBounds(markers.map((p) => [p.lat, p.lon]), { padding: [30, 30], maxZoom: 15 })
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// hint: the line under an editable map. Off where the page explains it.
export default function LocationMap({ lat, lon, label, points, zoom = 13, editable = false, onLocationChange, height = 'h-72', hint = true }) {
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
            attribution='Tiles &copy; Esri &mdash; Sources: Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
          />
        {editable && <ClickToSetLocation onLocationChange={onLocationChange} />}
        {!editable && <FitToMarkers markers={markers} zoom={zoom} />}

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
      {editable && hint && (
        <p className="mt-1 text-xs text-ink/50">
          {markers.length > 0 ? 'Click the map or drag the pin to adjust the location.' : "Click the map to set this sketch's location."}
        </p>
      )}
    </div>
  )
}
