import { useEffect, useState } from 'react'
import BasePage from '../components/common/BasePage'
import SketchSearch from '../components/common/SketchSearch'
import { useGeolocation } from '../lib/useGeolocation'
import { api } from '../lib/api'

const NEAR_LIMIT = 48

/**
 * A registered sketcher's Home: the header, the search box, and the
 * sketches near them in GRID / MAP (SketchListMapView). Registered
 * sketchers see each other's completed work; their own page is behind
 * their avatar in the header.
 */
export default function RegisteredUserHome() {
  const { coords, status } = useGeolocation()
  const [near, setNear] = useState(null)

  useEffect(() => {
    // Wait for a definite location answer, so the list doesn't swap.
    if (status === 'idle' || status === 'locating') return
    const params = { limit: NEAR_LIMIT, ...(coords ? { lat: coords.lat, lon: coords.lon } : {}) }
    api.get('/api/sketches/recent', { params }).then(({ data }) => setNear(data)).catch(() => setNear([]))
  }, [status, coords])

  return (
    <BasePage footer={false}>
      {near === null ? (
        <p className="m-0 animate-pulse text-sm text-ink/60">Finding sketches near you…</p>
      ) : (
        <SketchSearch initial={near} initialLabel={coords ? 'Sketches near you' : 'Recent sketches'} />
      )}
    </BasePage>
  )
}
