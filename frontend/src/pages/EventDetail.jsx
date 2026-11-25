import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import BasePage, { PageMessage } from '../components/common/BasePage'
import Avatar from '../components/common/Avatar'
import Button from '../components/common/Button'
import Comments from '../components/common/Comments'
import ConfirmDialog from '../components/common/ConfirmDialog'
import EventSetupPanel from '../components/common/EventSetupPanel'
import Icon from '../components/common/Icon'
import AttendeesPanel from '../components/common/AttendeesPanel'
import LocationMap from '../components/common/LocationMap'
import SketchListMapView from '../components/common/SketchListMapView'
import { useAuth } from '../components/common/AuthContext'
import { api } from '../lib/api'
import { imageUrl } from '../lib/media'
import { FORMATS, captureOpensLabel, eventWhen } from '../lib/events'
import NameHandle from '../components/common/NameHandle'
import ShareButtons from '../components/common/ShareButtons'
import { photoSlide } from '../lib/shareCarousel'
import { handle } from '../lib/people'

/**
 * An event (design doc, item 49), as an announcement: cover, title, when
 * (in its own time zone), where, the theme, the description, the
 * organisation and its links, Interested and who
 * you follow is interested, the hashtag, questions, sharing, the
 * participants' work (sketches linked to the event) and Report this event.
 */
export default function EventDetail() {
  const { eventId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [e, setE] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [showAttendees, setShowAttendees] = useState(false)
  const [copied, setCopied] = useState(null)
  const [uploading, setUploading] = useState(false)

  const load = () => api.get(`/api/events/${eventId}`).then(({ data }) => setE(data))
    .catch((err) => setError(err.response?.status === 404 ? 'This event is not here any more.' : 'Could not load the event.'))
  useEffect(() => { load() }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Instagram: the cover photo with the SketchConnect mark (none without a cover).
  const makeShareFiles = useCallback(() => (e?.cover_image_url
    ? photoSlide(imageUrl(e.cover_image_url), { watermark: true })
      .then((b) => [new File([b], `${e.hashtag || 'event'}.jpg`, { type: 'image/jpeg' })])
    : Promise.resolve([])), [e?.id, e?.cover_image_url]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <PageMessage>{error}</PageMessage>
  if (!e) return <PageMessage muted>Loading…</PageMessage>

  const past = new Date(e.ends_at) < new Date()
  // The address to share: /e/<id> gives Facebook a card with the cover
  // (backend share/router.py), then opens this page.
  const shareLink = `${window.location.origin}/e/${e.id}`
  const about = `${e.title}\n${eventWhen(e)}\n📍 ${e.place_name}`
  const captions = {
    facebook: `${about}\n\n#${e.hashtag} #urbansketchers`,
    instagram: `${about}\n\n#${e.hashtag} #urbansketchers #usk #sketchconnect`,
  }

  // The Capture button: for an Interested sketcher (or the organiser), once the event is on.
  const capture = e.capture && ['opens_later', 'open', 'closed'].includes(e.capture.state) ? e.capture : null
  function startCapture() {
    navigate('/capture', { state: { backgroundLocation: location, event: { id: e.id, title: e.title } } })
  }

  async function toggleInterest() {
    if (!user) return navigate('/login')
    const { data } = e.is_interested ? await api.delete(`/api/events/${e.id}/interest`) : await api.post(`/api/events/${e.id}/interest`)
    setE((x) => ({ ...x, ...data }))
    load() // the avatars and the Capture button follow
  }
  async function report() {
    setReporting(false)
    await api.post(`/api/events/${e.id}/report`, {})
    setE((x) => ({ ...x, reported: true }))
  }
  async function removeEvent() {
    await api.delete(`/api/events/${e.id}`)
    navigate('/events')
  }
  async function changeCover(ev) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('image', file)
      const { data } = await api.post(`/api/events/${e.id}/cover`, form)
      setE((x) => ({ ...x, cover_image_url: data.cover_image_url }))
    } finally { setUploading(false) }
  }
  async function toggleHidden(s) {
    if (s.hidden_from_event) await api.delete(`/api/events/${e.id}/hidden/${s.id}`)
    else await api.post(`/api/events/${e.id}/hidden/${s.id}`)
    load()
  }
  async function copy(what, text) {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 2000) } catch { /* nothing */ }
  }

  const link = (href, label) => href && (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold underline">
      <Icon name="link" size={13} /> {label}
    </a>
  )

  return (
    <BasePage>
      {/* ---- the announcement ---- */}
      <section className="grid items-start gap-8 md:grid-cols-[3fr_2fr] md:gap-12">
        <div className="flex flex-col gap-4">
          <span className="ed-bleed relative block aspect-[16/9] overflow-hidden bg-[var(--ed-field-bg)] md:rounded-md">
            {e.is_organizer && (
              <label className="absolute bottom-3 right-3 z-10 cursor-pointer rounded bg-white px-3 py-1.5 text-sm font-semibold text-ink shadow hover:bg-ink/5">
                {uploading ? 'Uploading…' : e.cover_image_url ? 'Change cover' : 'Add a cover photo'}
                <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={changeCover} />
              </label>
            )}
            {e.cover_image_url
              ? <img src={imageUrl(e.cover_image_url)} alt="" className="h-full w-full object-cover" />
              : <span className="flex h-full w-full items-center justify-center font-heading text-2xl font-semibold text-ink/40">#{e.hashtag}</span>}
          </span>
          <span className="ed-kicker">{past ? 'Past · ' : ''}{FORMATS[e.format] || 'Event'}{e.org_name ? ` · ${e.org_name}` : ''}</span>
          <h1 className="ed-title">{e.title}</h1>
          <p className="m-0 text-lg">{eventWhen(e)}</p>
          <p className="m-0 flex items-center gap-1.5 text-base text-ink/80"><Icon name="location" size={16} /> {e.place_name}</p>
          {e.theme && <p className="m-0 text-base"><span className="ed-caption">Theme</span> {e.theme}</p>}
          {e.description && <p className="m-0 whitespace-pre-line text-base leading-relaxed text-ink/85">{e.description}</p>}
          <div className="flex flex-wrap gap-4">
            {link(e.website_url, 'Website')}
            {link(e.ticket_url, 'Tickets')}
            {link(e.org_url, e.org_name || 'Organisation')}
          </div>
        </div>

        <aside className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex gap-3">
              <Button variant={e.is_interested ? 'editorial' : 'editorialSolid'} onClick={toggleInterest} disabled={e.is_organizer} className="flex-1">
                <Icon name={e.is_interested ? 'checkbox-checked' : 'checkbox'} size={15} /> {e.is_interested ? 'Interested' : "I'm interested"}
              </Button>
              {/* Capture: start a sketch here with the event attached. Needs Interested;
                  inactive before the start, open until 3 days after the end. */}
              {capture && (
                <Button variant="editorialSolid" onClick={startCapture} disabled={capture.state !== 'open'} className="flex-1"
                  title={capture.state === 'closed' ? 'Capture has closed. You can still link a sketch in its Details.' : undefined}>
                  <Icon name="camera" size={15} /> Capture
                </Button>
              )}
            </div>
            {capture?.state === 'opens_later' && <span className="text-xs text-ink/60">Capture opens {captureOpensLabel(e)}</span>}
          </div>

          {e.interested_count > 0 && (
            <div className="flex flex-col gap-2">
              <span className="ed-caption">Sketchers who are interested</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {(e.attendees || []).map((p) => (
                  <Link key={p.username} to={`/sketchers/${p.username}`} title={p.display_name || p.username}>
                    <Avatar url={p.avatar_url} className="h-8 w-8" />
                  </Link>
                ))}
                {e.interested_count > e.attendees.length && (
                  <button type="button" onClick={() => setShowAttendees(true)} className="cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-ink underline">
                    + {e.interested_count - e.attendees.length} more ...
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="ed-caption">Organised by</span>
            <Link to={`/sketchers/${e.organizer.username}`} className="flex items-center gap-2.5 text-ink no-underline">
              <Avatar url={e.organizer.avatar_url} className="h-9 w-9" />
              <NameHandle person={e.organizer} />
            </Link>
          </div>

          <div className="flex flex-col gap-2">
            <span className="ed-caption">Hashtag</span>
            <span className="flex items-center gap-2">
              <span className="font-heading text-lg font-semibold">#{e.hashtag}</span>
              <button type="button" className="text-xs font-semibold underline" onClick={() => copy('tag', `#${e.hashtag}`)}>{copied === 'tag' ? 'Copied' : 'Copy'}</button>
            </span>
            <span className="text-xs text-ink/55">Added to the caption when you share a sketch from this event.</span>
          </div>

          {/* Share: Facebook (a card with the cover) or Instagram (the cover). */}
          <ShareButtons link={shareLink} captions={captions} makeFiles={makeShareFiles} title={e.title} />

          {e.is_organizer ? (
            <div className="flex flex-wrap gap-2 border-t border-[var(--ed-row-rule)] pt-4">
              <Button variant="editorial" size="sm" onClick={() => setEditing(true)}>Edit event</Button>
              <Button variant="editorial" size="sm" onClick={() => setRemoving(true)}>Remove event</Button>
              {e.hidden && <span className="text-xs text-accent">Hidden after reports, until reviewed.</span>}
            </div>
          ) : user && (
            <button type="button" disabled={e.reported} onClick={() => setReporting(true)} className="self-start text-xs text-ink/55 underline disabled:no-underline">
              {e.reported ? 'Reported. Thank you.' : 'Report this event'}
            </button>
          )}
        </aside>
      </section>

      <section className="ed-section">
        <LocationMap lat={e.location.lat} lon={e.location.lon} label={e.place_name} height="h-64" hint={false} />
      </section>

      {/* ---- the participants' work ---- */}
      <section className="ed-section">
        <h2 className="ed-kicker m-0">{past ? 'Sketches from the event' : "Participants' work"} · {e.sketches.length}</h2>
        {e.sketches.length === 0 && (
          <p className="m-0 text-sm text-ink/60">
            No sketches yet. {capture?.state === 'not_interested' ? "Mark Interested, then Capture to start one here."
              : capture?.state === 'sign_in' ? 'Log in and mark Interested to sketch here.'
              : 'Tap Capture to start one here, or link a sketch in its Details.'}
          </p>
        )}
        {/* Grid and Map: where everyone sketched, around the meeting point
            and inside the area that counts as at the event (5 or 25 km). */}
        {e.sketches.length > 0 && (
          <SketchListMapView
            items={e.sketches.map((s) => ({
              id: s.id, title: s.title, place: s.location?.label, lat: s.location?.lat, lon: s.location?.lon,
              image: imageUrl(s.final_sketch_url || s.reference_image_url), sketch: s, dim: s.hidden_from_event,
            }))}
            center={{ lat: e.location.lat, lon: e.location.lon, radius: (e.type === 'meetup' ? 5 : 25) * 1000 }}
            below={e.is_organizer ? (it) => (
              <button type="button" className="self-start text-xs text-ink/60 underline" onClick={() => toggleHidden(it.sketch)}>
                {it.sketch.hidden_from_event ? 'Show on the event page' : 'Hide from the event page'}
              </button>
            ) : undefined}
          />
        )}
      </section>

      <Comments base={`/api/events/${e.id}`} removeBase="/api/event-comments" viewer={!user ? 'visitor' : e.is_organizer ? 'owner' : 'member'} userId={user?.id}
        title="Questions" placeholder="Ask the organiser a question" empty="No questions yet." loginText="Log in to ask a question" />

      {editing && <EventSetupPanel event={e} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load() }} />}
      {showAttendees && <AttendeesPanel eventId={e.id} onClose={() => setShowAttendees(false)} />}
      <ConfirmDialog open={removing} title="Remove this event?" message="It goes for everyone. Sketches linked to it stay on their sketchers' pages."
        confirmLabel="Remove" cancelLabel="Keep it" onConfirm={removeEvent} onCancel={() => setRemoving(false)} />
      <ConfirmDialog open={reporting} title="Report this event?" message="If it looks made up, spam or harmful. Three reports hide it until it is reviewed."
        confirmLabel="Report" cancelLabel="Cancel" onConfirm={report} onCancel={() => setReporting(false)} />
    </BasePage>
  )
}
