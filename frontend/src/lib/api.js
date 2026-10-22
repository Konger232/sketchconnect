import axios from 'axios'
import { supabase } from './supabaseClient'
import { registerPaints } from '../data/paints'

// One axios instance for every call to the FastAPI middle server. The
// Supabase session's JWT is attached to every request (design doc,
// Section 3, Auth: "Every request from React to the middle server carries
// this token").
export const api = axios.create({
  // Falls back to whatever hostname the page itself was loaded from --
  // localhost on the dev machine, or its LAN IP when opened from another
  // device (e.g. a phone on the same Wi-Fi, via Vite's "Network:" URL) --
  // so this doesn't need to be hardcoded per-device. VITE_API_URL in .env
  // still wins when set explicitly.
  baseURL: import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000`,
})

api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// The paint library (design doc, item 46): any palette or library the API
// returns joins the paint list, so paintById finds paints sketchers added.
api.interceptors.response.use((res) => {
  const d = res?.data
  if (d && typeof d === 'object') {
    if (Array.isArray(d.palette_paints)) registerPaints(d.palette_paints)
    if (Array.isArray(d.library)) registerPaints(d.library)
  }
  return res
})
