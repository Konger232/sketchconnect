import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import BasePage, { PageMessage } from '../components/common/BasePage'
import Button from '../components/common/Button'
import Icon from '../components/common/Icon'
import PaintEditor from '../components/common/PaintEditor'
import SketchListMapView from '../components/common/SketchListMapView'
import { useAuth } from '../components/common/AuthContext'
import AdmiredPanel from '../components/common/AdmiredPanel'
import EditKitPanel, { KIT_CATEGORIES } from '../components/common/EditKitPanel'
import BagPhotos from '../components/common/BagPhotos'
import EditProfilePanel from '../components/common/EditProfilePanel'
import FeaturedSlideshow from '../components/common/FeaturedSlideshow'
import FollowersPanel from '../components/common/FollowersPanel'
import { paintById } from '../data/paints'
import { api } from '../lib/api'
import { dateLabel, imageUrl } from '../lib/media'
import { useSketchesVersion } from '../lib/sketchEvents'
import Avatar from '../components/common/Avatar'

/**
 * The sketcher page (design handoff, "Sketcher Page - Editorial"; design
 * doc, item 36). One page, three viewers:
 *
 *   owner    the signed-in sketcher on their own page: Edit profile, Edit
 *            kit, paints, admired sketchers, sketches in progress.
 *   member   signed in, someone else's page: Follow.
 *   visitor  signed out: Follow goes to the login page.
 *
 * Served at /sketchers/:username, and at / for the signed-in sketcher
 * (HomePage). Sections: hero with the featured slideshow, the kit, admired
 * sketchers (owner only, by decision on October 17, 2026), the sketches.
 */
export default function SketcherProfile({ username: usernameProp }) {
  const params = useParams()
  const username = usernameProp || params.username
  const { user, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useSearchParams()
  const sketchesVersion = useSketchesVersion()

  const [page, setPage] = useState(null)
  const [sketches, setSketches] = useState([])
  const [error, setError] = useState(null)
  const [panel, setPanel] = useState(null) // 'profile' | 'kit' | 'admired' | 'followers'
  const [place, setPlace] = useState(null)
  const [filter, setFilter] = useState('') // the search bar over the sketches
  const [bagPhoto, setBagPhoto] = useState(0) // the bag photo shown
  const [wishlist, setWishlist] = useState([]) // the owner's wish list (item 44)
  const [busyFollow, setBusyFollow] = useState(false)
  const [paintEdit, setPaintEdit] = useState(null) // { mode, item?, top }
  const paintBoxRef = useRef(null)

  const viewer = page?.is_owner ? 'owner' : user ? 'member' : 'visitor'

  async function load() {
    try {
      const [p, s] = await Promise.all([
        api.get(`/api/sketchers/${username}`),
        api.get(`/api/sketchers/${username}/sketches`),
      ])
      setPage(p.data)
      setSketches(s.data)
      setError(null)
    } catch (err) {
      setError(err.response?.status === 404 ? 'not_found' : 'error')
    }
  }

  useEffect(() => { if (username) load() }, [username, user?.id, sketchesVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  // The wish list, for the owner only.
  useEffect(() => {
    if (!page?.is_owner) return
    api.get('/api/wishlist').then(({ data }) => setWishlist(data)).catch(() => setWishlist([]))
  }, [page?.is_owner, sketchesVersion])

  // NavDrawer's "Edit Profile" opens the panel: ?edit=profile.
  useEffect(() => {
    if (page?.is_owner && search.get('edit') === 'profile') {
      setPanel('profile')
      search.delete('edit')
      setSearch(search, { replace: true })
    }
  }, [page?.is_owner]) // eslint-disable-line react-hooks/exhaustive-deps

  const shared = useMemo(() => sketches.filter((s) => s.shared), [sketches])
  const inProgress = useMemo(() => sketches.filter((s) => !s.shared), [sketches])
  const toItem = (s, extra = {}) => ({
    id: s.id,
    title: s.title,
    meta: s.place || '',
    place: s.place,
    date: dateLabel(s.created_at),
    lat: s.location?.lat,
    lon: s.location?.lon,
    image: imageUrl(s.final_sketch_url || s.reference_image_url),
    sketch: s,
    ...extra,
  })
  // One list: the shared sketches, and for the owner their drafts too
  // (each card's status tells them apart). Search and Explore show shared
  // sketches only, so this is where a sketcher finds their drafts.
  const listed = viewer === 'owner' ? sketches : shared
  const listItems = useMemo(() => listed.map((s) => toItem(s)), [listed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Location circles: places by number of sketches, most first.
  const places = useMemo(() => {
    const by = new Map()
    for (const s of listed) {
      if (!s.place) continue
      if (!by.has(s.place)) by.set(s.place, { name: s.place, count: 0, image: imageUrl(s.final_sketch_url || s.reference_image_url) })
      by.get(s.place).count += 1
    }
    return [...by.values()].sort((a, b) => b.count - a.count)
  }, [listed])
  // The search bar over the list: a title or a place.
  const q = filter.trim().toLowerCase()
  const shownItems = listItems
    .filter((it) => !place || it.place === place)
    .filter((it) => !q || [it.title, it.sketch.location?.label, it.place].some((v) => v?.toLowerCase().includes(q)))

  if (error === 'not_found') {
    return <PageMessage>No sketcher at @{username}.</PageMessage>
  }
  if (!page) {
    return <PageMessage muted>{error ? 'Could not load this page.' : 'Loading…'}</PageMessage>
  }

  const firstName = (page.display_name || page.username || '').split(' ')[0]
  const featured = (page.featured?.length ? page.featured : shared.slice(0, 5)).map((s) => ({ ...s, place: s.place || shared.find((x) => x.id === s.id)?.place }))
  const favs = page.favorite_paints || []

  async function toggleFollow() {
    if (viewer === 'visitor') return navigate('/login', { state: { from: location.pathname } })
    setBusyFollow(true)
    try {
      const { data } = page.is_following
        ? await api.delete(`/api/sketchers/${page.username}/follow`)
        : await api.post(`/api/sketchers/${page.username}/follow`)
      setPage((p) => ({ ...p, is_following: data.is_following, stats: { ...p.stats, followers: data.followers } }))
    } finally {
      setBusyFollow(false)
    }
  }

  // ---- My palette (owner): PaintEditor under the row it edits ----
  function openPaint(mode, paintId, el) {
    const box = paintBoxRef.current?.getBoundingClientRect()
    const row = el?.closest('[data-paint-row]')?.getBoundingClientRect() || el?.getBoundingClientRect()
    const top = box && row ? row.bottom - box.top + 6 : 0
    setPaintEdit({ mode, top, paintId })
  }

  async function savePalette(next) {
    setPage((p) => ({ ...p, favorite_paints: next }))
    await api.put('/api/profile', { favorite_paints: next })
  }

  async function savePaint(paintId) {
    const was = paintEdit.mode === 'edit' ? paintEdit.paintId : null
    const next = was
      ? favs.map((x) => (x === was ? paintId : x)).filter((x, i, all) => all.indexOf(x) === i)
      : favs.includes(paintId) ? favs : [...favs, paintId]
    setPaintEdit(null)
    await savePalette(next)
  }

  // ---- the wish list (item 44) ----
  async function toggleWish(item) {
    const on = !item.wished
    setPage((p) => ({ ...p, kit: p.kit.map((i) => (i.id === item.id ? { ...i, wished: on } : i)) }))
    try {
      if (on) await api.post(`/api/wishlist/${item.id}`)
      else await api.delete(`/api/wishlist/${item.id}`)
    } catch {
      setPage((p) => ({ ...p, kit: p.kit.map((i) => (i.id === item.id ? { ...i, wished: !on } : i)) }))
    }
  }
  async function removeWish(w) {
    setWishlist((l) => l.filter((x) => x.id !== w.id))
    await api.delete(`/api/wishlist/${w.id}`).catch(() => {})
  }
  async function gotWish(w) {
    await api.post(`/api/wishlist/${w.id}/got`)
    setWishlist((l) => l.filter((x) => x.id !== w.id))
    load()
  }

  const counts = (
    <div className="flex flex-wrap justify-center gap-5 text-sm text-ink/80">
      <span className="whitespace-nowrap">{page.stats.sketches} sketches</span>
      <button type="button" className="whitespace-nowrap hover:underline" onClick={() => setPanel('followers')}>
        {page.stats.followers} {page.stats.followers === 1 ? 'follower' : 'followers'}
      </button>
      <span className="whitespace-nowrap">{page.stats.following} following</span>
    </div>
  )

  // Panels and modals over the page.
  const overlays = (
    <>
      {panel === 'profile' && (
        <EditProfilePanel
          profile={page}
          userId={user?.id}
          shared={shared.map((s) => ({ id: s.id, title: s.title, image: imageUrl(s.final_sketch_url || s.reference_image_url) }))}
          onClose={() => setPanel(null)}
          onSaved={async (data) => {
            setPanel(null)
            await refreshProfile?.()
            if (params.username && data.username !== params.username) navigate(`/sketchers/${data.username}`, { replace: true })
            else load()
          }}
        />
      )}
      {panel === 'kit' && (
        <EditKitPanel items={page.kit} photos={page.kit_photos || []} onClose={() => { setPanel(null); load() }} />
      )}
      {panel === 'admired' && (
        <AdmiredPanel list={page.admired || []} onClose={() => setPanel(null)} onChange={(list) => setPage((p) => ({ ...p, admired: list }))} />
      )}
      {panel === 'followers' && <FollowersPanel username={page.username} onClose={() => setPanel(null)} />}
    </>
  )

  return (
    <BasePage overlays={overlays}>
      {/* ---- 1. Hero ---- */}
      <section className="grid items-center gap-7 md:grid-cols-2 md:gap-14">
        <div className="flex flex-col items-center gap-4 text-center md:px-6">
          {/* The profile photo, 80px; the smiley face without one. */}
          <Avatar url={page.avatar_url} className="h-20 w-20" />
          <span className="ed-kicker">Sketcher{page.location ? ` · ${page.location}` : ''}</span>
          <h1 className="ed-title">{page.display_name || `@${page.username}`}</h1>
          {page.bio && <p className="m-0 max-w-[420px] text-base leading-normal text-ink/90">{page.bio}</p>}
          <span className="ed-kicker mt-1 tracking-[0.14em]">By @{page.username}</span>
          {counts}
          <div className="mt-2 flex flex-wrap justify-center gap-2.5">
            {viewer === 'owner' ? (
              <>
                <Button variant="editorialSolid" className="min-w-[180px]" onClick={() => setPanel('profile')}>Edit profile</Button>
                <Button variant="editorial" className="min-w-[120px]" onClick={async () => { await signOut(); navigate('/') }}>Sign out</Button>
              </>
            ) : (
              <Button variant="editorialSolid" active={page.is_following} className="min-w-[180px]" onClick={toggleFollow} disabled={busyFollow}>
                {page.is_following ? 'Following' : 'Follow'}
              </Button>
            )}
          </div>
          {Object.entries(page.links || {}).length > 0 && (
            <div className="flex flex-wrap justify-center gap-4 text-sm">
              {Object.entries(page.links).map(([kind, url]) => (
                <a key={kind} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold capitalize underline">
                  <Icon name="link" size={14} /> {kind}
                </a>
              ))}
            </div>
          )}
        </div>
        <FeaturedSlideshow sketches={featured} />
      </section>

      {/* ---- 2. What's in my bag (design doc, item 44) ---- */}
      <section className="ed-section">
        <div className="ed-section-head">
          <h2 className="ed-kicker m-0">{viewer === 'owner' ? "What's in my bag" : `What's in ${firstName}'s bag`}</h2>
          {viewer === 'owner' && <Button variant="editorial" onClick={() => setPanel('kit')}>Edit gear</Button>}
        </div>
        <div className="grid gap-8 md:grid-cols-[5fr_6fr] md:gap-14">
          {(page.kit_photos || []).length > 0 ? (
            <BagPhotos photos={page.kit_photos} items={page.kit} active={bagPhoto} onActive={setBagPhoto} alt={`${firstName}'s bag`} />
          ) : (
            <span className="photo-placeholder relative block aspect-[4/5] w-full overflow-hidden md:aspect-auto md:min-h-[420px]">
              {viewer === 'owner' && (
                <button type="button" onClick={() => setPanel('kit')} className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink/60 underline">
                  Upload a photo of your sketch bag or your usual sketching gear to share with the community.
                </button>
              )}
            </span>
          )}
          <dl className="m-0 border-t border-[var(--ed-row-rule)]">
            {page.kit.length === 0 && <p className="py-4 text-sm text-ink/50">Nothing in the bag yet.</p>}
            {KIT_CATEGORIES.map(({ category, label }) => {
              const items = page.kit.filter((i) => i.category === category)
              if (!items.length) return null
              return (
                <div key={category} className="ed-row">
                  <dt>{label}</dt>
                  <dd className="flex flex-col gap-1.5">
                    {items.map((i) => (
                      <span key={i.id} className="flex items-start gap-2">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span>
                            {i.label}
                            {i.link && (
                              <a href={i.link} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex align-middle text-ink/60 hover:text-ink" aria-label={`Where to get ${i.label}`}>
                                <Icon name="link" size={13} />
                              </a>
                            )}
                          </span>
                          {i.note && <span className="ed-note">{i.note}</span>}
                        </span>
                        {/* Another sketcher stars a tool for their wish list. */}
                        {viewer === 'member' && (
                          <button type="button" className="ed-icon-btn" aria-pressed={Boolean(i.wished)}
                            aria-label={i.wished ? `Remove ${i.label} from my wish list` : `Add ${i.label} to my wish list`}
                            title={i.wished ? 'On your wish list' : 'Add to your wish list'} onClick={() => toggleWish(i)}>
                            <Icon name={i.wished ? 'star-filled' : 'star'} size={15} />
                          </button>
                        )}
                      </span>
                    ))}
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>
      </section>

      {/* ---- My palette: the paints the colour recipes mix from (item 44) ---- */}
      {(viewer === 'owner' || favs.length > 0) && (
        <section className="ed-section">
          <h2 className="ed-kicker m-0">{viewer === 'owner' ? 'My palette' : `${firstName}'s palette`}</h2>
          <div ref={paintBoxRef} className="relative flex max-w-xl flex-col gap-1">
            {favs.length === 0 && <p className="m-0 text-sm text-ink/60">Add the paints you carry. The Color tab mixes its recipes from them.</p>}
            {favs.map((id) => {
              const p = paintById(id)
              if (!p) return null
              return (
                <div key={id} data-paint-row className="flex items-center gap-3 py-1">
                  {/* The swatch is data: an inline background. */}
                  <span className="swatch-chip" style={{ background: p.hex }} />
                  <span className="w-[72px] shrink-0 text-xs font-bold">{p.code}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {viewer === 'owner' && (
                    <>
                      <button type="button" className="ed-icon-btn" aria-label={`Change ${p.name}`} onClick={(e) => openPaint('edit', id, e.currentTarget)}>
                        <Icon name="edit" size={14} />
                      </button>
                      <button type="button" className="ed-icon-btn" aria-label={`Remove ${p.name}`} onClick={() => savePalette(favs.filter((x) => x !== id))}>
                        <Icon name="delete" size={15} />
                      </button>
                    </>
                  )}
                </div>
              )
            })}
            {viewer === 'owner' && (
              <Button variant="editorial" size="sm" className="mt-1 self-start" onClick={(e) => openPaint('new', null, e.currentTarget)}>
                <Icon name="plus" size={14} /> Add paint
              </Button>
            )}
            {paintEdit && (
              <PaintEditor
                open
                mode={paintEdit.mode}
                paintId={paintEdit.paintId}
                favs={favs}
                top={paintEdit.top}
                onSave={savePaint}
                onClose={() => setPaintEdit(null)}
                onToggleFav={(id) => savePalette(favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id])}
              />
            )}
          </div>
        </section>
      )}

      {/* ---- My wish list: only the owner sees it (item 44) ---- */}
      {viewer === 'owner' && wishlist.length > 0 && (
        <section className="ed-section">
          <div className="ed-section-head">
            <h2 className="ed-kicker m-0">My wish list</h2>
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
              <Icon name="lock" size={13} /> Only you
            </span>
          </div>
          <ul className="m-0 flex max-w-2xl list-none flex-col p-0">
            {wishlist.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--ed-row-rule)] py-2.5">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{w.label}</span>
                  <span className="ed-note">
                    {[w.note, w.owner?.username ? `in @${w.owner.username}'s bag` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <a href={w.link || `https://www.google.com/search?q=${encodeURIComponent(w.label)}`} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-semibold underline">{w.link ? 'Where to get it' : 'Search for it'}</a>
                <Button variant="editorial" size="sm" onClick={() => gotWish(w)}>I got it</Button>
                <button type="button" className="ed-icon-btn" aria-label={`Remove ${w.label} from my wish list`} onClick={() => removeWish(w)}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- 3. Admired sketchers (owner only) ---- */}
      {viewer === 'owner' && (
        <section className="ed-section">
          <div className="ed-section-head">
            <h2 className="ed-kicker m-0">Admired sketchers</h2>
            <span className="flex items-center gap-3">
              <span className="hidden items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/60 md:inline-flex">
                <Icon name="lock" size={13} /> Only you
              </span>
              <Button variant="editorial" onClick={() => setPanel('admired')}>Edit list</Button>
            </span>
          </div>
          {page.admired?.length ? (
            <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {page.admired.map((a) => {
                let where = 'their page'
                try { if (a.link) where = new URL(a.link).hostname.replace(/^www\./, '') } catch { /* keep the default */ }
                return (
                  <li key={a.id} className="flex items-center gap-3">
                    {a.link ? (
                      <a href={a.link} target="_blank" rel="noopener noreferrer" aria-label={`${a.name} on ${where}`}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink hover:bg-ink/10">
                        <Icon name="globe" size={18} />
                      </a>
                    ) : (
                      <span className="h-11 w-11 shrink-0 rounded-full bg-ink/5" />
                    )}
                    <span className="flex flex-col">
                      <span className="text-lg">{a.name}</span>
                      {a.location && <span className="ed-caption">{a.location}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink/60">Add the sketchers you learn from. Your coach reads your final sketches with an eye to what you admire in them.</p>
          )}
        </section>
      )}

      {/* ---- 4. The sketches ---- */}
      <section className="ed-section">
        <div className="ed-section-head">
          <h2 className="ed-kicker m-0">The sketches</h2>
          {viewer === 'owner' && inProgress.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
              <Icon name="lock" size={13} /> Drafts: only you
            </span>
          )}
        </div>
        <label className="flex items-center gap-3 border-b border-ink/40 pb-2 focus-within:border-ink">
          <Icon name="search" size={16} className="text-ink/60" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by title or place"
            aria-label="Search these sketches by title or place" className="w-full bg-transparent py-1 text-base outline-none placeholder:text-ink/40" />
        </label>
        {places.length > 0 && (
          <div className="flex gap-5 overflow-x-auto pb-1">
            {places.map((p) => (
              <button key={p.name} type="button" onClick={() => setPlace(place === p.name ? null : p.name)} aria-pressed={place === p.name}
                className="flex w-[84px] shrink-0 flex-col items-center gap-1.5 text-ink">
                <span className={`ed-avatar h-[72px] w-[72px] border-2 ${place === p.name ? 'border-ink' : 'border-ink/10'}`}>
                  {p.image && <img src={p.image} alt="" className="h-full w-full object-cover grayscale" />}
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.06em]">{p.name}</span>
                <span className="-mt-1 text-xs text-ink/60">{p.count}</span>
              </button>
            ))}
          </div>
        )}
        {place && (
          <p className="m-0 text-sm">
            {place} · <button type="button" className="font-semibold underline" onClick={() => setPlace(null)}>Show all</button>
          </p>
        )}
        <SketchListMapView items={shownItems} pinMode="place" onPlaceSelect={setPlace} searchPlaces
          emptyText={q ? `No sketches match "${filter.trim()}".` : viewer === 'owner' ? 'Your sketches show here.' : 'No shared sketches yet.'} />
      </section>

    </BasePage>
  )
}
