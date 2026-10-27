import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import BasePage, { PageMessage } from '../components/common/BasePage'
import Avatar from '../components/common/Avatar'
import Button from '../components/common/Button'
import Comments from '../components/common/Comments'
import ConfirmDialog from '../components/common/ConfirmDialog'
import EventSetupPanel from '../components/common/EventSetupPanel'
import Icon from '../components/common/Icon'
import LocationMap from '../components/common/LocationMap'
import SketchCard from '../components/common/SketchCard'
import { useAuth } from '../components/common/AuthContext'
import { api } from '../lib/api'
import { imageUrl } from '../lib/media'
import { EVENT_TYPES, eventWhen } from '../lib/events'

/**
 * An event (design doc, item 49), as an announcement: cover, title, when
 * (in its own time zone), where, the theme, the description, the
 * organisation and its links, the featured instructors, Interested and who
 * you follow is interested, the hashtag, questions, sharing, the
 * participants' work (sketches with the hashtag) and Report this event.
 */
export default function EventDetail() {
  const { eventId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [e, setE] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [copied, setCopied] = useState(null)

  const load = () => api.get(`/api/events/${eventId}`).then(({ data }) => setE(data))
    .catch((err) => setError(err.response?.status === 404 ? 'This event is not here any more.' : 'Could not load the event.'))
  useEffect(() => { load() }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <BasePage><PageMessage>{error}</PageMessage></BasePage>
  if (!e) return <BasePage><PageMessage muted>Loading…</PageMessage></BasePage>

  const past = new Date(e.ends_at) < new Date()
  const pageUrl = `${window.location.origin}/events/${e.id}`
  const shareText = `${e.title} · ${eventWhen(e)} · ${e.place_name}\n#${e.hashtag} #urbansketchers #sketchconnect`
  const me = e.instructors.find((i) => i.is_me)

  async function toggleInterest() {
    if (!user) return navigate('/login')
    const { data } = e.is_interested ? await api.delete(`/api/events/${e.id}/interest`) : await api.post(`/api/events/${e.id}/interest`)
    setE((x) => ({ ...x, ...data }))
  }
  async function answer(yes) {
    await api.post(`/api/events/${e.id}/instructors/${yes ? 'accept' : 'decline'}`)
    load()
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
  async function toggleHidden(s) {
    if (s.hidden_from_event) await api.delete(`/api/events/${e.id}/hidden/${s.id}`)
    else await api.post(`/api/events/${e.id}/hidden/${s.id}`)
    load()
  }
  async function copy(what, text) {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 2000) } catch { /* nothing */ }
  }
  async function shareNative() {
    try { await navigator.share({ title: e.title, text: shareText, url: pageUrl }) } catch { /* cancelled */ }
  }

  const link = (href, label) => href && (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold underline">
      <Icon name="link" size={13} /> {label}
    </a>
  )
  const confirmed = e.instructors.filter((i) => i.status === 'confirmed')
  const pending = e.instructors.filter((i) => i.status !== 'confirmed')

  return (
    <BasePage>
      {/* ---- the announcement ---- */}
      <section className="grid items-start gap-8 md:grid-cols-[3fr_2fr] md:gap-12">
        <div className="flex flex-col gap-4">
          <span className="block aspect-[16/9] overflow-hidden rounded-md bg-[var(--ed-field-bg)]">
            {e.cover_image_url
              ? <img src={imageUrl(e.cover_image_url)} alt="" className="h-full w-full object-cover" />
              : <span className="flex h-full w-full items-center justify-center font-heading text-2xl font-semibold text-ink/40">#{e.hashtag}</span>}
          </span>
          <span className="ed-kicker">{past ? 'Past · ' : ''}{EVENT_TYPES[e.kind === 'crawl' ? 'crawl' : e.event_type] || 'Event'}{e.org_name ? ` · ${e.org_name}` : ''}</span>
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
            <Button variant={e.is_interested ? 'editorial' : 'editorialSolid'} onClick={toggleInterest} disabled={e.is_organizer}>
              <Icon name={e.is_interested ? 'star-filled' : 'star'} size={15} /> {e.is_interested ? 'Interested' : "I'm interested"}
            </Button>
            <span className="text-sm text-ink/70">{e.interested_count} {e.interested_count === 1 ? 'sketcher' : 'sketchers'} interested</span>
            {e.friends_interested.length > 0 && (
              <span className="flex items-center gap-2 text-sm text-ink/70">
                <span className="flex -space-x-2">{e.friends_interested.slice(0, 4).map((p) => <Avatar key={p.username} url={p.avatar_url} className="h-7 w-7 border-2 border-white" />)}</span>
                {e.friends_interested.slice(0, 2).map((p) => p.display_name || `@${p.username}`).join(', ')}
                {e.friends_interested.length > 2 ? ` and ${e.friends_interested.length - 2} more you follow` : ' (you follow)'}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="ed-caption">Organised by</span>
            <Link to={`/sketchers/${e.organizer.username}`} className="flex items-center gap-2.5 text-ink no-underline">
              <Avatar url={e.organizer.avatar_url} className="h-9 w-9" />
              <span className="font-semibold">{e.organizer.display_name || `@${e.organizer.username}`}</span>
            </Link>
          </div>

          {(confirmed.length > 0 || (e.is_organizer && pending.length > 0)) && (
            <div className="flex flex-col gap-2">
              <span className="ed-caption">Featured instructors</span>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {confirmed.map((i) => (
                  <li key={i.id}>
                    {i.sketcher ? (
                      <Link to={`/sketchers/${i.sketcher.username}`} className="flex items-center gap-2.5 text-ink no-underline">
                        <Avatar url={i.sketcher.avatar_url} className="h-9 w-9" />
                        <span className="font-semibold">{i.sketcher.display_name || `@${i.sketcher.username}`}</span>
                      </Link>
                    ) : <span className="flex items-center gap-2.5"><Avatar className="h-9 w-9" /> <span className="font-semibold">{i.name}</span></span>}
                  </li>
                ))}
                {e.is_organizer && pending.map((i) => (
                  <li key={i.id} className="flex items-center gap-2.5 text-ink/55">
                    <Avatar url={i.sketcher?.avatar_url} className="h-9 w-9 opacity-60" />
                    <span>@{i.sketcher?.username} · {i.status === 'declined' ? 'declined' : 'invited, not answered yet'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {me && me.status === 'invited' && (
            <div className="flex flex-col gap-2 rounded-md bg-[var(--ed-field-bg)] p-3">
              <span className="text-sm font-semibold">You're invited as a featured instructor.</span>
              <span className="flex gap-2">
                <Button variant="editorialSolid" size="sm" onClick={() => answer(true)}>Accept</Button>
                <Button variant="editorial" size="sm" onClick={() => answer(false)}>Decline</Button>
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="ed-caption">Hashtag</span>
            <span className="flex items-center gap-2">
              <span className="font-heading text-lg font-semibold">#{e.hashtag}</span>
              <button type="button" className="text-xs font-semibold underline" onClick={() => copy('tag', `#${e.hashtag}`)}>{copied === 'tag' ? 'Copied' : 'Copy'}</button>
            </span>
            <span className="text-xs text-ink/55">Add it to your sketch's title or notes and it shows here.</span>
          </div>

          {/* Share: the phone's share sheet (Instagram, WhatsApp…), Facebook, or the link. */}
          <div className="flex flex-wrap gap-2">
            {typeof navigator !== 'undefined' && navigator.share && <Button variant="editorial" size="sm" onClick={shareNative}><Icon name="share" size={14} /> Share</Button>}
            <Button variant="editorial" size="sm" onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`, '_blank', 'noopener')}>Facebook</Button>
            <Button variant="editorial" size="sm" onClick={() => copy('post', `${shareText}\n${pageUrl}`)}>{copied === 'post' ? 'Copied' : 'Copy for Instagram'}</Button>
            <Button variant="editorial" size="sm" onClick={() => copy('link', pageUrl)}>{copied === 'link' ? 'Copied' : 'Copy link'}</Button>
          </div>

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
        {e.sketches.length === 0 && <p className="m-0 text-sm text-ink/60">No sketches yet. Add #{e.hashtag} to a sketch's title or notes to show it here.</p>}
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3">
          {e.sketches.map((s) => (
            <div key={s.id} className={`flex flex-col gap-1 ${s.hidden_from_event ? 'opacity-50' : ''}`}>
              <SketchCard sketch={s} />
              {e.is_organizer && (
                <button type="button" className="self-start text-xs text-ink/60 underline" onClick={() => toggleHidden(s)}>
                  {s.hidden_from_event ? 'Show on the event page' : 'Hide from the event page'}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <Comments base={`/api/events/${e.id}`} removeBase="/api/event-comments" viewer={!user ? 'visitor' : e.is_organizer ? 'owner' : 'member'} userId={user?.id}
        title="Questions" placeholder="Ask the organiser a question" empty="No questions yet." loginText="Log in to ask a question" />

      {editing && <EventSetupPanel event={e} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load() }} />}
      <ConfirmDialog open={removing} title="Remove this event?" message="It goes for everyone. Sketches with its hashtag stay on their sketchers' pages."
        confirmLabel="Remove" cancelLabel="Keep it" onConfirm={removeEvent} onCancel={() => setRemoving(false)} />
      <ConfirmDialog open={reporting} title="Report this event?" message="If it looks made up, spam or harmful. Three reports hide it until it is reviewed."
        confirmLabel="Report" cancelLabel="Cancel" onConfirm={report} onCancel={() => setReporting(false)} />
    </BasePage>
  )
}
