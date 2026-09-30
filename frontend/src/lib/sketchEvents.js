import { useSyncExternalStore } from 'react'

/**
 * "The sketcher's sketches changed": a counter that goes up whenever a
 * sketch is created, edited or deleted in a modal (CreateSketch,
 * EditSketch). Pages that list sketches (LoggedInHome, ProfilePage,
 * SearchPage) refetch when it changes.
 *
 * Why this is needed: those pages stay mounted under the modal (the
 * backgroundLocation overlay in App.jsx). Closing the modal goes back in
 * history to the same entry, so location.key doesn't change and the list
 * would keep showing what it had before the modal opened.
 */
let version = 0
const listeners = new Set()

export function notifySketchesChanged() {
  version += 1
  listeners.forEach((listener) => listener())
}

export function useSketchesVersion() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
}
