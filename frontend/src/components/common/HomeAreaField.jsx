import { useEffect, useState } from 'react'
import Button from './Button'
import LocationMap from './LocationMap'
import LocationSearchField from './LocationSearchField'
import { api } from '../../lib/api'

/**
 * The home area, in Edit profile (November 25, 2026): a private place and a
 * size. A sketch drawn inside it shows no pin and no place name to anyone
 * else (backend app/core/home_area.py). Only the sketcher ever sees it.
 * Saved on its own (GET, PUT and DELETE /api/profile/home-area), not with
 * the profile's Save, so the count of hidden sketches is right at once.
 */
const RADII = [
  { m: 500, label: '500 m' },
  { m: 1000, label: '1 km' },
  { m: 2000, label: '2 km' },
]

export default function HomeAreaField() {
  const [saved, setSaved] = useState(null) // { lat, lon, radius_m } or null
  const [spot, setSpot] = useState(null) // { lat, lon, label? } being placed
  const [radius, setRadius] = useState(1000)
  const [hidden, setHidden] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)

  function take(data) {
    setSaved(data.home)
    setHidden(data.hidden || 0)
    if (data.home) {
      setSpot({ lat: data.home.lat, lon: data.home.lon })
      setRadius(data.home.radius_m)
    }
  }
  useEffect(() => {
    api.get('/api/profile/home-area').then(({ data }) => take(data)).catch(() => {}).finally(() => setLoaded(true))
  }, [])

  const changed = spot && (!saved || saved.lat !== spot.lat || saved.lon !== spot.lon || saved.radius_m !== radius)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.put('/api/profile/home-area', { lat: spot.lat, lon: spot.lon, radius_m: radius })
      take(data)
    } catch (err) {
      const d = err.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Could not save your home area.')
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.delete('/api/profile/home-area')
      take(data)
      setSpot(null)
    } catch {
      setError('Could not remove your home area.')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink/70">Home area</span>
      <span className="text-xs text-ink/60">
        Sketches drawn inside this area show no pin and no place name to anyone else. Only you see this area.
      </span>
      <LocationSearchField location={spot} onLocationChange={(l) => setSpot(l)} />
      <LocationMap
        lat={spot?.lat}
        lon={spot?.lon}
        zoom={radius >= 2000 ? 12 : 14}
        editable
        hint={false}
        height="h-[220px]"
        onLocationChange={(l) => setSpot(l)}
        focus={spot ? { lat: spot.lat, lon: spot.lon, zoom: radius >= 2000 ? 12 : 14 } : null}
        ring={spot ? { lat: spot.lat, lon: spot.lon, radius } : null}
      />
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Size of the home area">
        {RADII.map((r) => (
          <button key={r.m} type="button" role="radio" aria-checked={radius === r.m} onClick={() => setRadius(r.m)}
            className={`border-[1.5px] px-3 py-1.5 text-sm font-semibold ${radius === r.m ? 'border-ink bg-ink text-white' : 'border-ink/30 text-ink hover:border-ink'}`}>
            {r.label}
          </button>
        ))}
        <span className="ml-auto flex gap-2">
          {saved && <Button variant="editorial" size="sm" onClick={remove} disabled={busy}>Remove</Button>}
          <Button variant="editorialSolid" size="sm" onClick={save} disabled={busy || !changed}>
            {busy ? 'Saving…' : saved ? 'Update' : 'Set home area'}
          </Button>
        </span>
      </div>
      {!spot && <span className="text-xs text-ink/50">Search for your street, or tap the map where you live.</span>}
      {saved && !changed && (
        <span className="text-xs text-ink/60">
          {hidden === 0 ? 'None of your sketches are inside it yet.' : `${hidden} of your sketches ${hidden === 1 ? 'is' : 'are'} inside it, with the location hidden from others.`}
        </span>
      )}
      {error && <span className="text-xs text-accent">{error}</span>}
    </div>
  )
}
