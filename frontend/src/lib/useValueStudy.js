import { useEffect, useState } from 'react'
import { api } from './api'

/**
 * The "value_study" overlay: the sketch's framed photo simplified into a
 * few flat value shapes (GET /api/sketches/:id/value-study, OpenCV, not
 * cached server-side). Fetched the first time it's shown, reused after.
 * Resets when `sketchId` or `resetKey` changes.
 */
export function useValueStudy(sketchId, resetKey) {
  const [image, setImage] = useState(null)
  const [shown, setShown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setImage(null)
    setShown(false)
    setError(null)
  }, [sketchId, resetKey])

  async function show() {
    setShown(true)
    if (image || loading || !sketchId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get(`/api/sketches/${sketchId}/value-study`)
      setImage(data.valueStudyImage)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not make the value study right now.')
      setShown(false)
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    if (shown) setShown(false)
    else show()
  }

  return { image, shown: shown && !!image, loading, error, show, toggle }
}
