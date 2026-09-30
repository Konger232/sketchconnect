import { useEffect, useState } from 'react'

/**
 * Fades a guide in when `show` turns on and out when it turns off, instead
 * of it popping. Used for every photo guide: focal points, marks, grids,
 * perspective, proportions, focal shapes, value shapes. Keeps its children
 * mounted until the fade-out ends. Timing: --guide-fade-in and
 * --guide-fade-out in index.css.
 *
 *   <Fade show={showMarks}><MarksLayer … /></Fade>            inside an SVG
 *   <Fade as="div" show={showPerspective}><PerspectiveLinesOverlay … /></Fade>
 *
 * Always pass the children, even while hidden; `show` decides visibility.
 */
export default function Fade({ show, as: Tag = 'g', className = '', children, ...rest }) {
  const [mounted, setMounted] = useState(show)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (show) {
      setMounted(true)
      setLeaving(false)
    } else if (mounted) {
      setLeaving(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  function handleAnimationEnd(e) {
    // Only this element's own fade, not an animation inside it.
    if (e.target !== e.currentTarget || !leaving) return
    setMounted(false)
    setLeaving(false)
  }

  if (!mounted) return null
  return (
    <Tag
      className={`guide-fade ${leaving ? 'guide-fade--out' : 'guide-fade--in'} ${className}`}
      onAnimationEnd={handleAnimationEnd}
      {...rest}
    >
      {children}
    </Tag>
  )
}
