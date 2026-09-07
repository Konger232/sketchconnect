import { useState } from 'react'
import Header from '../components/layout/Header'
import Button from '../components/common/Button'
import { STYLES } from '../data/styles'
import { api } from '../lib/api'

// One admired-artist slot per style (design doc: "each style holds exactly
// one admired artist slot"). Saving triggers the one-time Persona Creation
// call; the result is cached server-side and reused by every later
// critique for that style.
export default function SettingsPage() {
  const [artists, setArtists] = useState({})
  const [status, setStatus] = useState({})

  async function save(styleValue) {
    setStatus((s) => ({ ...s, [styleValue]: 'saving' }))
    try {
      await api.post('/api/persona', {
        style: styleValue,
        admired_artist_name: artists[styleValue] || null,
      })
      setStatus((s) => ({ ...s, [styleValue]: 'saved' }))
    } catch {
      setStatus((s) => ({ ...s, [styleValue]: 'error' }))
    }
  }

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-2xl px-4 pb-16">
        <h1 className="mt-4 text-xl font-bold">Admired artists</h1>
        <p className="mt-1 text-sm text-ink/60">
          Pick an artist whose teaching style or commentary should shape your critique
          voice for each style. Leave blank for a system default persona.
        </p>

        <div className="mt-6 flex flex-col gap-5">
          {STYLES.map((s) => (
            <div key={s.value}>
              <label className="block text-sm font-medium">{s.label}</label>
              <div className="mt-1 flex gap-2">
                <input
                  placeholder="e.g. Liz Steel"
                  value={artists[s.value] || ''}
                  onChange={(e) => setArtists((a) => ({ ...a, [s.value]: e.target.value }))}
                  className="flex-1 rounded-lg border border-black/15 px-3 py-2"
                />
                <Button variant="outline" onClick={() => save(s.value)}>
                  {status[s.value] === 'saving' ? 'Saving…' : 'Save'}
                </Button>
              </div>
              {status[s.value] === 'saved' && <p className="mt-1 text-xs text-green-700">Saved</p>}
              {status[s.value] === 'error' && <p className="mt-1 text-xs text-accent">Could not save</p>}
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
