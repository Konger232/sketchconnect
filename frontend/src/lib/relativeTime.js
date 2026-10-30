// "5 days ago" / "June 15" style formatting, matching the SketchCard copy
// seen in both the Figma prototype and the Claude Design canvas.
export function relativeTime(dateString) {
  if (!dateString) return ''
  const date = new Date(dateString)
  const days = Math.floor((Date.now() - date.getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  // Over a week: the date, with the year when it is not this year.
  const year = date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', ...year })
}
