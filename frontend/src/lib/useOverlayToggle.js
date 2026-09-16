import { useEffect, useState } from 'react'

/**
 * A togglable image-overlay mode: starts at 'none', flips to 'all' and
 * back via `toggle`, and resets to 'none' whenever `resetKey` changes --
 * covers "a fresh scene analysis came in, drop whatever overlay was
 * showing for the last photo."
 */
export function useOverlayToggle(resetKey) {
  const [mode, setMode] = useState('none')

  useEffect(() => {
    setMode('none')
  }, [resetKey])

  function toggle() {
    setMode((prev) => (prev === 'none' ? 'all' : 'none'))
  }

  return { mode, toggle }
}