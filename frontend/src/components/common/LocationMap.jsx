import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { Circle, MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Leaflet finds its default marker images by a CSS path that a Vite
// build breaks. Point it at the bundled files instead.
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow })

// Pins drawn with the app's own classes (index.css .ed-pin*), for
// SketchListMapView: a teardrop per sketch, a count disc per place, or the
// "this sketch" dot. Leaflet takes the markup as a string.
const PIN_SVG = '<svg viewBox="0 0 18 24" width="18" height="24" aria-hidden="true"><path fill="currentColor" d="M9 0C4 0 0 3.9 0 8.8 0 15.4 9 24 9 24s9-8.6 9-15.2C18 3.9 14 0 9 0z"/><circle cx="9" cy="8.8" r="3.2" fill="#fff"/></svg>'

// A read-only map shows the design's pin; a draggable one keeps Leaflet's.
const readOnlyIcon = L.divIcon({
  className: '',
  html: `<span class="ed-pin" data-active="true">${PIN_SVG}</span>`,
  iconSize: [18, 24],
  iconAnchor: [9, 24],
})

export function pinIcon(pin) {
  if (pin.variant === 'center') {
    return L.divIcon({ className: '', html: '<span class="ed-pin-center"></span>', iconSize: [14, 14], iconAnchor: [7, 7] })
  }
  if (pin.variant === 'count') {
    return L.divIcon({
      className: '',
      html: `<span class="ed-pin-count" data-active="${Boolean(pin.active)}">${pin.count}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    })
  }
  // big: the pin picked (Explore's list), twice the size, with a halo.
  if (pin.big) {
    return L.divIcon({
      className: '',
      html: `<span class="ed-pin ed-pin-big" data-active="${Boolean(pin.active)}">${PIN_SVG.replace('width="18" height="24"', 'width="36" height="48"')}</span>`,
      iconSize: [36, 48],
      iconAnchor: [18, 48],
    })
  }
  return L.divIcon({
    className: '',
    html: `<span class="ed-pin" data-active="${Boolean(pin.active)}">${PIN_SVG}</span>`,
    iconSize: [18, 24],
    iconAnchor: [9, 24],
  })
}

// Flies the map to `focus` { lat, lon, zoom? } when it changes (a place
// picked in the search over the map).
function FlyTo({ focus }) {
  const map = useMap()
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lon], focus.zoom || 13, { duration: 0.8 })
  }, [focus?.lat, focus?.lon]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// Clicks on the map itself, to close an open pin card.
function MapClicks({ onMapClick }) {
  useMapEvents({ click: () => onMapClick?.() })
  return null
}

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
//
// Custom pins (SketchListMapView): `pins` [{ id, lat, lon, variant
// ('pin' | 'count' | 'center'), count, active }] replace the default
// markers. onPinClick(pin, { x, y }) gets the pin's position in the map, in
// px, so a card can open beside it. `ring` { lat, lon, radius } draws a
// dashed circle (radius in metres). onMapClick: a click on empty map.
export default function LocationMap({
  lat, lon, label, points, zoom = 13, editable = false, onLocationChange, height = 'h-72', hint = true,
  pins, onPinClick, onMapClick, ring, rounded = true, focus,
}) {
  const custom = Boolean(pins?.length)
  const markers = custom ? pins : points?.length ? points : (lat != null && lon != null ? [{ lat, lon, label }] : [])
  const icons = useMemo(() => (custom ? pins.map(pinIcon) : []), [custom, pins])

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
      <MapContainer center={center} zoom={initialZoom} scrollWheelZoom={editable} className={`${height} w-full ${rounded ? 'rounded-lg' : ''}`}>
        <TileLayer
            attribution='Tiles &copy; Esri &mdash; Sources: Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
          />
        {editable && <ClickToSetLocation onLocationChange={onLocationChange} />}
        {!editable && <FitToMarkers markers={markers} zoom={zoom} />}
        {onMapClick && <MapClicks onMapClick={onMapClick} />}
        {focus && <FlyTo focus={focus} />}
        {ring && (
          <Circle
            center={[ring.lat, ring.lon]}
            radius={ring.radius}
            pathOptions={{ color: '#111111', weight: 1.5, dashArray: '6 6', fillOpacity: 0.04 }}
          />
        )}

        {custom && pins.map((p, i) => (
          <Marker
            key={p.id ?? i}
            position={[p.lat, p.lon]}
            icon={icons[i]}
            zIndexOffset={p.active ? 1000 : p.variant === 'center' ? 500 : 0}
            eventHandlers={onPinClick && p.variant !== 'center' ? {
              click: (e) => {
                L.DomEvent.stopPropagation(e)
                const pt = e.target._map.latLngToContainerPoint(e.latlng)
                onPinClick(p, { x: pt.x, y: pt.y })
              },
            } : undefined}
          />
        ))}

        {!custom && markers.map((p, i) => (
          <Marker
            key={i}
            position={[p.lat, p.lon]}
            {...(editable ? {} : { icon: readOnlyIcon })}
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
