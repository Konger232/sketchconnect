import { useState } from 'react'
import Button from './Button'
import ConfirmDialog from './ConfirmDialog'
import FloatPanel from './FloatPanel'
import { api } from '../../lib/api'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from './AuthContext'
import Avatar from './Avatar'

const LINKS = [
  { key: 'instagram', label: 'Instagram', placeholder: 'instagram.com/yourname' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'tiktok.com/@yourname' },
  { key: 'facebook', label: 'Facebook', placeholder: 'facebook.com/yourname' },
  { key: 'website', label: 'Website', placeholder: 'yourname.com' },
]
const MAX_FEATURED = 5

/**
 * Edit profile (design handoff, Sketcher page): photo, name, username,
 * introduction, home cities, links, and the featured sketches for the
 * slideshow, in order. A modal FloatPanel; a bottom sheet on a phone.
 * Saves with PUT /api/profile. The photo goes to Supabase storage, as
 * before (the old EditProfilePage).
 */
export default function EditProfilePanel({ profile, shared, userId, onClose, onSaved }) {
  // The sign-in email, shown read-only. Google owns a Google account's
  // email; changing an email account's address would need Supabase's
  // confirm-by-email flow, which is not built. Only the owner sees this.
  const { user } = useAuth()
  const providers = user?.app_metadata?.providers || [user?.app_metadata?.provider].filter(Boolean)
  const signInNote = providers.includes('google') ? 'Signed in with Google' : 'Signed in with email and password'
  const [form, setForm] = useState({
    display_name: profile.display_name || '',
    username: profile.username || '',
    bio: profile.bio || '',
    location: profile.location || '',
    links: { ...(profile.links || {}) },
    avatar_url: profile.avatar_url || '',
  })
  const [featured, setFeatured] = useState((profile.featured || []).map((s) => s.id))
  const [choosing, setChoosing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [dirty, setDirty] = useState(false)

  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setDirty(true) }
  const setLink = (key, value) => { setForm((f) => ({ ...f, links: { ...f.links, [key]: value } })); setDirty(true) }

  function toggleFeatured(id) {
    setDirty(true)
    setFeatured((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length < MAX_FEATURED ? [...list, id] : list))
  }

  async function changePhoto(e) {
    const file = e.target.files?.[0]
    if (!file || !userId) return
    setUploading(true)
    setError(null)
    try {
      const path = `${userId}/avatar.${file.name.split('.').pop()}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      set('avatar_url', `${data.publicUrl}?v=${Date.now()}`)
    } catch (err) {
      setError(err.message || 'Could not upload the photo.')
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const { data } = await api.put('/api/profile', { ...form, featured_sketch_ids: featured })
      onSaved?.(data)
    } catch (err) {
      const d = err.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose())
  const byId = Object.fromEntries(shared.map((s) => [s.id, s]))

  return (
    <>
      <FloatPanel
        placement="modal"
        title="Edit profile"
        onClose={requestClose}
        footer={
          <>
            {error && <span className="mr-auto text-sm text-accent">{error}</span>}
            <Button variant="editorial" size="sm" onClick={requestClose}>Cancel</Button>
            <Button variant="action" onClick={save} disabled={saving || uploading}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <div className="flex items-center gap-4">
          <Avatar url={form.avatar_url} className="h-16 w-16" />
          <label className="cursor-pointer">
            <span className="inline-flex min-h-10 items-center border-[1.5px] border-ink px-3.5 text-sm font-bold text-ink">
              {uploading ? 'Uploading…' : 'Change photo'}
            </span>
            <input type="file" accept="image/*" onChange={changePhoto} disabled={uploading} className="hidden" />
          </label>
        </div>

        <label className="block">
          <span>Name</span>
          <input className="field-input mt-1.5" value={form.display_name} maxLength={80} onChange={(e) => set('display_name', e.target.value)} />
        </label>
        {user?.email && (
          <div className="block">
            <span className="text-sm font-medium text-ink/70">Email</span>
            <input className="field-input mt-1.5 cursor-not-allowed bg-ink/5 text-ink/60" value={user.email} readOnly aria-readonly="true" aria-label="Email" tabIndex={-1} />
            <span className="mt-1 block text-xs text-ink/50">{signInNote}. Only you see this.</span>
          </div>
        )}
        <label className="block">
          <span>Username</span>
          <input className="field-input mt-1.5" value={form.username} maxLength={31}
            onChange={(e) => set('username', e.target.value.replace(/^@/, '').toLowerCase())} />
          <span className="mt-1 block text-xs text-ink/50">Your page: /sketchers/{form.username || 'yourname'}</span>
        </label>
        <label className="block">
          <span>Introduction</span>
          <textarea className="field-input mt-1.5 min-h-[88px]" value={form.bio} maxLength={300} onChange={(e) => set('bio', e.target.value)}
            placeholder="What you draw, where, and with what." />
        </label>
        <label className="block">
          <span>Home cities</span>
          <input className="field-input mt-1.5" value={form.location} maxLength={120} placeholder="Princeton & Osaka" onChange={(e) => set('location', e.target.value)} />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-ink/70">Links</legend>
          {LINKS.map((l) => (
            <input key={l.key} className="field-input" aria-label={l.label} placeholder={`${l.label}: ${l.placeholder}`}
              value={form.links[l.key] || ''} onChange={(e) => setLink(l.key, e.target.value)} />
          ))}
        </fieldset>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink/70">Featured sketches (slideshow, in order)</span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {featured.length === 0 && <span className="text-sm text-ink/50">None picked. Your newest sketches show instead.</span>}
            {featured.map((id, i) => byId[id] && (
              <span key={id} className="relative h-[90px] w-[72px] shrink-0">
                <span className="ed-slide block h-full">{byId[id].image && <img src={byId[id].image} alt="" />}</span>
                <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-2xs font-bold text-white">{i + 1}</span>
              </span>
            ))}
          </div>
          <button type="button" className="self-start text-sm font-bold underline" onClick={() => setChoosing((c) => !c)}>
            {choosing ? 'Done choosing' : 'Choose sketches'}
          </button>
          {choosing && (
            <div className="grid grid-cols-4 gap-2 md:grid-cols-6">
              {shared.length === 0 && <span className="col-span-full text-sm text-ink/50">Share a sketch first: upload its final sketch.</span>}
              {shared.map((s) => {
                const n = featured.indexOf(s.id)
                return (
                  <button key={s.id} type="button" onClick={() => toggleFeatured(s.id)} aria-pressed={n >= 0}
                    className={`relative ${n >= 0 ? 'outline outline-2 outline-ink' : ''}`} title={s.title || 'Untitled sketch'}>
                    <span className="ed-slide block">{s.image && <img src={s.image} alt="" />}</span>
                    {n >= 0 && <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-2xs font-bold text-white">{n + 1}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </FloatPanel>
      <ConfirmDialog
        open={confirmClose}
        title="Discard changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => { setConfirmClose(false); onClose() }}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  )
}

