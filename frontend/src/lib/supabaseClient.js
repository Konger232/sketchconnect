import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anonKey)

if (!supabaseConfigured) {
  // Loud in the console, but deliberately NOT throwing — createClient()
  // throws synchronously on a missing key, which crashes the whole app at
  // module load (blank white page, no React error boundary can catch it).
  // A stub client below keeps the app renderable so App.jsx can show a
  // real message instead.
  console.error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — see frontend/.env.example. ' +
    'Auth and API calls will not work until both are filled in.'
  )
}

const stubClient = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ error: { message: 'Supabase is not configured yet.' } }),
    signUp: async () => ({ error: { message: 'Supabase is not configured yet.' } }),
    signOut: async () => ({ error: null }),
  },
}

export const supabase = supabaseConfigured ? createClient(url, anonKey) : stubClient
