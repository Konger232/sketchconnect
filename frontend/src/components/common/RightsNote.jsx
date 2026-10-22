import { Link } from 'react-router-dom'

/**
 * The copying statement under a sketcher's work (design doc: protecting
 * sketchers' work). Links to the "Your work is yours" page.
 *
 *   name   the sketcher's name
 *   dark   on a dark panel (the upload screen)
 */
export default function RightsNote({ name, dark = false, className = '' }) {
  const year = new Date().getFullYear()
  return (
    <p className={`m-0 text-xs leading-relaxed ${dark ? 'text-sc-text3' : 'text-ink/60'} ${className}`}>
      {name ? `© ${year} ${name}. ` : ''}All rights reserved. No copying, sharing or use for AI training without the
      sketcher's permission.{' '}
      <Link to="/your-work" className="underline">Your work is yours</Link>
    </p>
  )
}
