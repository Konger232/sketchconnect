import axios from 'axios'
import { supabase } from './supabaseClient'

// One axios instance for every call to the FastAPI middle server. The
// Supabase session's JWT is attached to every request (design doc,
// Section 3, Auth: "Every request from React to the middle server carries
// this token").
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
})

api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})
