// Haversine great-circle distance between two {lat, lon} points, in km.
// Used client-side by SearchPage to rank/filter already-loaded sketches
// against a geocoded search location, without a round trip to the
// backend for every keystroke -- the backend's own ST_DWithin/ST_Distance
// query (see routers/sketches.py's /sketches/recent) is used instead when
// searching the full public feed, since that data isn't already in hand.
const EARTH_RADIUS_KM = 6371

function toRad(deg) {
  return (deg * Math.PI) / 180
}

export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}
