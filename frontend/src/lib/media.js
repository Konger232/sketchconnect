import { api } from './api'

// A stored upload path ("/uploads/x.jpg") as a full URL on the API server;
// full URLs (Supabase storage, Google photos) pass through.
export const imageUrl = (url) => (!url ? null : url.startsWith('http') ? url : `${api.defaults.baseURL}${url}`)

// "Oct 12, 2026" and "2:40 PM", from an ISO date.
export function dateLabel(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
export function timeLabel(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
