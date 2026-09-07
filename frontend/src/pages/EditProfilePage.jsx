import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/layout/Header'
import Button from '../components/common/Button'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { api } from '../lib/api'
import { STYLES } from '../data/styles'

// Editable profile info (display name, avatar, location). "Favorite urban
// sketchers" is deliberately read-only here -- it reads the per-style
// admired-artist personas already set in Settings (design doc: "one artist
// per style") rather than keeping its own separate field, so there's one
// place that data lives instead of two copies that can drift apart.
export default function EditProfilePage() {
  const { user } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [location, setLocation] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [personas, setPersonas] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    Promise.all([api.get('/api/profile'), api.get('/api/personas')])
      .then(([profileRes, personasRes]) => {
        setDisplayName(profileRes.data.display_name || '')
        setLocation(profileRes.data.location || '')
        setAvatarUrl(profileRes.data.avatar_url || '')
        setPersonas(personasRes.data)
      })
      .catch(() => setError('Could not load your profile.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleAvatarChange(e) {
    const file = e.target.files[0]
    if (!file || !user) return
    setUploading(true)
    setError(null)
    try {
      const ext = file.name.split('.').pop()
      const path = `${user.id}/avatar.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setAvatarUrl(data.publicUrl)
    } catch (err) {
      setError(err.message || 'Could not upload image.')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await api.put('/api/profile', {
        display_name: displayName,
        avatar_url: avatarUrl,
        location,
      })
      setNotice('Profile saved.')
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }

  const styleLabel = (value) => STYLES.find((s) => s.value === value)?.label || value
  const favorites = personas.filter((p) => p.admired_artist_name)

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-sm px-6 py-10">
        <h1 className="font-heading text-4xl font-bold text-ink">Edit Profile</h1>

        {loading ? (
          <p className="mt-6 text-ink/50">Loading…</p>
        ) : (
          <form onSubmit={handleSave} className="mt-8 flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <div
                className="h-16 w-16 shrink-0 rounded-full bg-black/10 bg-cover bg-center"
                style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
              />
              <label className="text-sm">
                <span className="cursor-pointer text-blue-600 underline">
                  {uploading ? 'Uploading…' : 'Change photo'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-lg" style={{ color: 'var(--sc-label)' }}>Display name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jane Doe"
                className="sc-input mt-2"
              />
            </label>

            <label className="block">
              <span className="text-lg" style={{ color: 'var(--sc-label)' }}>Location</span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="San Francisco, CA"
                className="sc-input mt-2"
              />
            </label>

            <div>
              <span className="text-lg" style={{ color: 'var(--sc-label)' }}>Favorite urban sketchers</span>
              <p className="mt-1 text-sm text-ink/60">
                Pulled from the admired artist you set per style in Settings.
              </p>
              <div className="mt-2 flex flex-col gap-1">
                {favorites.length === 0 && (
                  <p className="text-sm text-ink/50">
                    None set yet — <Link to="/settings" className="text-blue-600 underline">add one in Settings</Link>.
                  </p>
                )}
                {favorites.map((p) => (
                  <p key={p.style} className="text-sm text-ink">
                    <span className="font-semibold">{styleLabel(p.style)}:</span> {p.admired_artist_name}
                  </p>
                ))}
              </div>
              {favorites.length > 0 && (
                <Link to="/settings" className="mt-2 inline-block text-sm text-blue-600 underline">
                  Edit in Settings
                </Link>
              )}
            </div>

            {error && <p className="text-sm" style={{ color: 'var(--sc-error)' }}>{error}</p>}
            {notice && <p className="text-sm text-green-700">{notice}</p>}

            <Button type="submit" disabled={saving || uploading}>
              {saving ? 'Saving…' : 'Save profile'}
            </Button>
          </form>
        )}
      </main>
    </div>
  )
}
