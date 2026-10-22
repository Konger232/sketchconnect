import { useEffect, useState } from 'react'

const QUERY = '(min-width: 768px)'

// A computer-sized screen (Tailwind md). Forms sit on the photo or float
// beside the wheel there; on a phone they are a bottom sheet.
export function useWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(QUERY).matches)
  useEffect(() => {
    const m = window.matchMedia(QUERY)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}
