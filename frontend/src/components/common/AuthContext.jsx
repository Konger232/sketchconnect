import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { api } from '../../lib/api'

const AuthContext = createContext(null)

// Component wraps the whole app in App.jsx
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)

  // Fetch login info from DB 
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => sub.subscription.unsubscribe()
  }, []) //[] means that it only runs once, when the component first appears

  // Fetch profile data. refreshProfile() reloads it after Edit profile
  // saves (the header's name, the username in the address).
  const refreshProfile = () =>
    api.get('/api/profile').then(({ data }) => { setProfile(data); return data }).catch(() => null)
  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    refreshProfile()
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const displayName = profile?.display_name || session?.user?.user_metadata?.full_name || session?.user?.email

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    displayName,
    loading,
    refreshProfile,
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
