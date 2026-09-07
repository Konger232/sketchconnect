import { useEffect, useState } from 'react'

/**
 * Browser GPS, best-effort. Resolves to {lat, lon} once the user grants
 * permission, or stays null forever if they deny it or the browser has no
 * geolocation support — callers should treat null as "no coordinates to
 * filter by" and fall back to an unfiltered view, never block on it.
 */
export function useGeolocation() {
  const [coords, setCoords] = useState(null)
  const [status, setStatus] = useState('idle') // idle | locating | granted | denied | unsupported

  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus('unsupported')
      return
    }
    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setStatus('granted')
      },
      () => setStatus('denied'),
      { timeout: 8000, maximumAge: 5 * 60 * 1000 }
    )
  }, [])

  return { coords, status }
}
