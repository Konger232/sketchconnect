import { useEffect, useState } from 'react'

/**
 * Progress for a wait with no real progress events (the scene analysis
 * and critique calls return all at once). Walks through the steps on a
 * timer, from `start`, one every `stepMs`, and holds on the last step
 * until the result arrives and the caller moves on. Also counts the
 * seconds waited, so the sketcher can see it's still working.
 *
 *   const { current, seconds } = useStagedProgress({ count: 3, start: 0, stepMs: 8000 })
 */
export function useStagedProgress({ count, start = 0, stepMs = 8000, active = true }) {
  const [current, setCurrent] = useState(start)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!active) return
    setCurrent(start)
    setSeconds(0)
    const began = Date.now()
    const timer = setInterval(() => {
      const elapsed = Date.now() - began
      setSeconds(Math.floor(elapsed / 1000))
      setCurrent(Math.min(count - 1, start + Math.floor(elapsed / stepMs)))
    }, 250)
    return () => clearInterval(timer)
  }, [active, count, start, stepMs])

  return { current, seconds }
}
