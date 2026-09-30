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

  // Turn on (never off): used when a guided-question answer asks for it.
  function show() {
    setMode('all')
  }

  // Turn off: used when another overlay takes its place.
  function hide() {
    setMode('none')
  }

  return { mode, toggle, show, hide }
}