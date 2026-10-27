import { useEffect, useMemo, useRef, useState } from 'react'
import Button from './Button'
import FloatPanel from './FloatPanel'
import LocationSearchField from './LocationSearchField'
import PhotoDropzone from './PhotoDropzone'
import Avatar from './Avatar'
import { api } from '../../lib/api'
import { imageUrl } from '../../lib/media'
import { hashtagFrom, localInput } from '../../lib/events'

const FORMAT_OPTIONS = [['crawl', 'Sketch crawl or walk'], ['workshop', 'Workshop'], ['festival', 'Festival'], ['symposium', 'Symposium']]

/**
 * Set up an event (design doc, item 49): a floating panel (the bottom sheet
 * on a phone) that starts with the two types:
 *   Casual meet-up   a casual gathering: title, when, where (a scouted spot
 *                    or the place search), theme, hashtag
 *   Organised event  run by an organisation: also its name and website, the
 *                    the description, the website or
 *                    brochure and ticket links, and featured instructors
 * Every event is at a real place. Times are in the browser's time zone,
 * which is the event's own when it is set up from there.
 *
 *   event     the event to edit (from the event page), or none to set one up
 *   onSaved(event), onClose()
 */
export default function EventSetupPanel({ event, onSaved, onClose }) {
  const editing = Boolean(event)
  const [type, setType] = useState(event?.type || null)
  const [check, setCheck] = useState(null) // the earn-it checklist and the caps
  const [spots, setSpots] = useState([])
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const start0 = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return d }, [])
  const [f, setF] = useState(() => ({
    title: event?.title || '', theme: event?.theme || '', description: event?.description || '',
    hashtag: event?.hashtag || '', tagTouched: Boolean(event),
    starts: localInput(event ? new Date(event.starts_at) : start0),
    ends: localInput(event ? new Date(event.ends_at) : new Date(start0.getTime() + 3 * 3600000)),
    place: event?.location ? { lat: event.location.lat, lon: event.location.lon, label: event.place_name } : null,
    spot_id: event?.spot_id || null,
    format: event?.format || 'crawl',
    org_name: event?.org_name || '', org_url: event?.org_url || '',
    website_url: event?.website_url || '', ticket_url: event?.ticket_url || '',
    instructors: (event?.instructors || []).map((i) => (i.sketcher ? { username: i.sketcher.username } : { name: i.name })),
  }))
  const [newInstructor, setNewInstructor] = useState('')
  const [matches, setMatches] = useState([]) // sketchers matching what is typed
  useEffect(() => {
    const t = newInstructor.trim().replace(/^@/, '')
    if (t.length < 2) { setMatches([]); return undefined }
    const timer = setTimeout(() => {
      api.get('/api/sketcher-lookup', { params: { q: t } })
        .then(({ data }) => setMatches(data.filter((p) => !f.instructors.some((i) => i.username === p.username))))
        .catch(() => setMatches([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [newInstructor]) // eslint-disable-line react-hooks/exhaustive-deps
  function pickInstructor(p) {
    set({ instructors: [...f.instructors, { username: p.username, display_name: p.display_name, avatar_url: p.avatar_url }] })
    setNewInstructor('')
    setMatches([])
  }
  const [cover, setCover] = useState(null)
  const coverInput = useRef(null)
  const coverPreview = useMemo(() => (cover ? URL.createObjectURL(cover) : imageUrl(event?.cover_image_url)), [cover, event?.cover_image_url])
  useEffect(() => () => { if (cover && coverPreview) URL.revokeObjectURL(coverPreview) }, [cover, coverPreview])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/events/can-host').then(({ data }) => setCheck(data)).catch(() => setCheck(null))
    api.get('/api/spots').then(({ data }) => setSpots(data.filter((s) => s.location))).catch(() => setSpots([]))
  }, [])

  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  // The hashtag follows the title until the organiser changes it.
  const setTitle = (title) => set({ title, ...(f.tagTouched ? {} : { hashtag: hashtagFrom(title) }) })

  const blocked = !editing && check && !check.earned
  const meetupsFull = !editing && check && !check.relaxed && type === 'meetup' && check.meetups_this_month >= check.meetups_per_month
  const orgOpen = !editing && check && !check.relaxed && type === 'organised' && check.organised_open
  // A casual meet-up has a date and a start time; it ends with its day.
  const meetup = type === 'meetup'
  const [date, time] = f.starts.split('T')
  const ends = meetup ? `${date}T23:59` : f.ends
  const ready = f.title.trim() && f.hashtag.trim().length >= 3 && f.place && date && time && ends && !busy

  function addInstructor() {
    const t = newInstructor.trim()
    if (!t) return
    set({ instructors: [...f.instructors, t.startsWith('@') ? { username: t.slice(1) } : { name: t }] })
    setNewInstructor('')
  }

  async function save() {
    setBusy(true)
    setError(null)
    const body = {
      type, format: f.format,
      title: f.title, theme: f.theme || null, description: f.description || null,
      hashtag: f.hashtag.replace(/^#/, ''),
      starts_at: new Date(f.starts).toISOString(), ends_at: new Date(ends).toISOString(), time_zone: event?.time_zone || tz,
      place_name: f.place.label || 'Meeting point', lat: f.place.lat, lon: f.place.lon, spot_id: f.spot_id,
      org_name: f.org_name || null, org_url: f.org_url || null, website_url: f.website_url || null, ticket_url: f.ticket_url || null,
      instructors: type === 'organised' ? f.instructors : [],
    }
    try {
      const { data } = editing ? await api.put(`/api/events/${event.id}`, body) : await api.post('/api/events', body)
      if (cover) {
        const form = new FormData()
        form.append('image', cover)
        const c = await api.post(`/api/events/${data.id}/cover`, form)
        data.cover_image_url = c.data.cover_image_url
      }
      onSaved(data)
    } catch (err) {
      const d = err?.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Could not save the event. Check the fields and try again.')
    } finally {
      setBusy(false)
    }
  }

  const field = (label, el, hint) => (
    <label className="flex flex-col gap-1">
      <span className="ed-caption">{label}</span>
      {el}
      {hint && <span className="text-xs text-ink/55">{hint}</span>}
    </label>
  )

  // ---- the first step: which type ----
  const choose = (
    <div className="flex flex-col gap-4">
      {check && !check.earned && (
        <div className="flex flex-col gap-1.5 rounded-md bg-[var(--ed-field-bg)] p-3 text-sm">
          <span className="font-semibold">Setting up an event is for sketchers who have sketched with us a while:</span>
          <span>{check.completed_sketches >= check.needed_sketches ? '✓' : '○'} {check.needed_sketches} completed sketches ({check.completed_sketches} so far)</span>
          <span>{check.has_palette ? '✓' : '○'} Your paint collection</span>
          <span>{check.has_bag ? '✓' : '○'} What's in your bag</span>
        </div>
      )}
      {check?.relaxed && <p className="m-0 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">Testing: the event rules are off (RELAXED_EVENT_RULES).</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {[
          ['meetup', 'Casual meet-up', 'A casual gathering at a real place: a few sketchers, a time and a meeting spot.',
            check && !check.relaxed ? `${check.meetups_this_month} of ${check.meetups_per_month} this month` : null],
          ['organised', 'Organised event', 'A sketch crawl, workshop or festival run by an organisation, with its website and instructors.',
            check && !check.relaxed && check.organised_open ? 'You have one coming up' : 'One at a time'],
        ].map(([k, title, text, note]) => (
          <button key={k} type="button" disabled={blocked} onClick={() => setType(k)}
            className="flex flex-col gap-1.5 rounded-lg border-[1.5px] border-ink/20 p-4 text-left hover:border-ink disabled:opacity-50">
            <span className="font-heading text-lg font-semibold">{title}</span>
            <span className="text-sm text-ink/70">{text}</span>
            {note && <span className="text-xs text-ink/50">{note}</span>}
          </button>
        ))}
      </div>
    </div>
  )

  // ---- the second step: the form ----
  const form = (
    <div className="flex flex-col gap-4">
      {!editing && (
        <button type="button" className="self-start text-xs font-semibold underline" onClick={() => setType(null)}>← Choose the other type</button>
      )}
      {(meetupsFull || orgOpen) && (
        <p className="m-0 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {meetupsFull ? `You have set up ${check.meetups_per_month} casual meet-ups this month. Pick a date next month.` : 'You have an organised event coming up. You can set up the next one once it has ended.'}
        </p>
      )}
      {type === 'organised' && (
        <div className="grid gap-3 md:grid-cols-2">
          {field('Organisation', <input className="field-input" maxLength={150} value={f.org_name} onChange={(e) => set({ org_name: e.target.value })} placeholder="e.g. Urban Sketchers Bangkok" />)}
          {field("Organisation's website", <input className="field-input" type="url" maxLength={300} value={f.org_url} onChange={(e) => set({ org_url: e.target.value })} placeholder="https://" />)}
        </div>
      )}
      {/* The cover: a photo of the place or the poster; it shows on the event card. */}
      <div className="flex flex-col gap-1">
        <span className="ed-caption">Cover photo (optional)</span>
        <input ref={coverInput} type="file" accept="image/*" className="hidden" onChange={(e) => { setCover(e.target.files?.[0] || null); e.target.value = '' }} />
        {coverPreview ? (
          <span className="relative block h-56 overflow-hidden rounded-md bg-[var(--ed-field-bg)]">
            <img src={coverPreview} alt="" className="h-full w-full object-cover" />
            <span className="absolute bottom-2 right-2 flex gap-1.5">
              <Button variant="editorial" size="sm" onClick={() => coverInput.current?.click()}>Change</Button>
              {cover && <Button variant="editorial" size="sm" onClick={() => setCover(null)}>Undo</Button>}
            </span>
          </span>
        ) : (
          <PhotoDropzone light className="aspect-[16/9] max-h-56" title="Add a cover photo"
            text="A photo of the place or your poster. It shows on the event card." onClick={() => coverInput.current?.click()} />
        )}
      </div>
      {field('Title', <input className="field-input" maxLength={150} value={f.title} autoFocus onChange={(e) => setTitle(e.target.value)}
        placeholder={type === 'meetup' ? 'e.g. Saturday morning at the river' : 'e.g. Sketch Festival 2027'} />)}
      {field('Format', (
        <select className="field-select" value={f.format} onChange={(e) => set({ format: e.target.value })}>
          {FORMAT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ))}
      <div className="grid gap-3 md:grid-cols-2">
        {meetup ? (<>
          {field('Date', <input className="field-input" type="date" value={date} onChange={(e) => set({ starts: `${e.target.value}T${time || '09:00'}` })} />)}
          {field('Start time', <input className="field-input" type="time" value={time} onChange={(e) => set({ starts: `${date}T${e.target.value}` })} />)}
        </>) : (<>
          {field('Starts', <input className="field-input" type="datetime-local" value={f.starts} onChange={(e) => set({ starts: e.target.value })} />)}
          {field('Ends', <input className="field-input" type="datetime-local" value={f.ends} min={f.starts} onChange={(e) => set({ ends: e.target.value })} />)}
        </>)}
      </div>
      <span className="-mt-2 text-xs text-ink/55">Times in {(event?.time_zone || tz).replace(/_/g, ' ')}.</span>

      {field(type === 'meetup' ? 'Meeting spot' : 'Place', (
        <div className="flex flex-col gap-2">
          {spots.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {spots.map((s) => (
                <button key={s.id} type="button" aria-pressed={f.spot_id === s.id}
                  onClick={() => set({ spot_id: s.id, place: { lat: s.location.lat, lon: s.location.lon, label: s.place_name ? `${s.name}, ${s.place_name}` : s.name } })}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${f.spot_id === s.id ? 'border-ink bg-ink text-white' : 'border-ink/20 hover:border-ink'}`}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <LocationSearchField location={f.place} onLocationChange={(loc) => set({ place: loc, spot_id: null })} />
        </div>
      ), spots.length ? 'One of your scouted spots, or search for the place.' : 'Search for the place.')}

      {field('Theme (optional)', <input className="field-input" maxLength={120} value={f.theme} onChange={(e) => set({ theme: e.target.value })} placeholder="e.g. Doors of the old town" />)}
      {field('Description', <textarea className="field-input min-h-[84px] resize-y" maxLength={4000} value={f.description} onChange={(e) => set({ description: e.target.value })}
        placeholder={type === 'meetup' ? 'Where to meet, what to bring, coffee after?' : 'What the event is, who it is for, what happens.'} />)}

      {field('Hashtag', (
        <span className="flex items-center gap-1">
          <span className="text-lg font-semibold text-ink/60">#</span>
          <input className="field-input" maxLength={40} value={f.hashtag} onChange={(e) => set({ hashtag: e.target.value.replace(/[^A-Za-z0-9_]/g, ''), tagTouched: true })} />
        </span>
      ), 'Sketchers add it to a sketch\'s title or notes, and the sketch shows on the event page.')}

      {type === 'organised' && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {field('Website or brochure', <input className="field-input" type="url" maxLength={300} value={f.website_url} onChange={(e) => set({ website_url: e.target.value })} placeholder="https://" />)}
            {field('Tickets (optional)', <input className="field-input" type="url" maxLength={300} value={f.ticket_url} onChange={(e) => set({ ticket_url: e.target.value })} placeholder="https://" />)}
          </div>
          {field('Featured instructors', (
            <div className="flex flex-col gap-2">
              {f.instructors.length > 0 && (
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {f.instructors.map((i, n) => (
                    <li key={n} className="flex items-center gap-1 rounded-full border border-ink/20 py-1 pl-3 pr-1 text-xs font-semibold">
                      {i.username ? `@${i.username}` : i.name}
                      <button type="button" aria-label="Remove" className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-ink/10"
                        onClick={() => set({ instructors: f.instructors.filter((_, k) => k !== n) })}>×</button>
                    </li>
                  ))}
                </ul>
              )}
              <span className="flex gap-2">
                <input className="field-input" value={newInstructor} onChange={(e) => setNewInstructor(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); if (matches.length) pickInstructor(matches[0]); else addInstructor() }
                    if (e.key === 'Escape') setMatches([])
                  }} placeholder="Search sketchers, or type a name" />
                <Button variant="editorial" size="sm" onClick={addInstructor}>Add</Button>
              </span>
              {/* Sketchers on SketchConnect matching the text: a tap adds one. */}
              {matches.length > 0 && (
                <ul className="m-0 list-none overflow-hidden rounded-md border border-ink/15 bg-white p-0">
                  {matches.map((p) => (
                    <li key={p.username}>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickInstructor(p)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-ink/5">
                        <Avatar url={p.avatar_url} className="h-7 w-7" />
                        <span className="min-w-0 truncate text-sm"><b>{p.display_name || p.username}</b> <span className="text-ink/55">@{p.username}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ), 'Pick a sketcher from the list: they get a request and show once they accept. Anyone else shows by name.')}
        </>
      )}
    </div>
  )

  return (
    <FloatPanel placement="modal" title={editing ? 'Edit event' : type === 'meetup' ? 'Set up a casual meet-up' : type === 'organised' ? 'Set up an organised event' : 'Set up an event'}
      width="760px" onClose={onClose} closeOnOutside={!type}
      footer={type ? (
        <>
          {error && <span className="mr-auto text-sm text-accent">{error}</span>}
          <Button variant="editorial" onClick={onClose}>Cancel</Button>
          <Button variant="action" disabled={!ready || meetupsFull || orgOpen} onClick={save}>{busy ? 'Saving…' : editing ? 'Save' : 'Set it up'}</Button>
        </>
      ) : null}>
      {type ? form : choose}
      {!type && !check && <p className="m-0 text-sm text-ink/50">Checking…</p>}
    </FloatPanel>
  )
}
