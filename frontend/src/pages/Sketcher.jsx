import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Header from '../components/common/Header'
import Footer from '../components/common/Footer'
import Button from '../components/common/Button'
import Icon from '../components/common/Icon'
import PaintEditor from '../components/common/PaintEditor'
import SketchListMapView from '../components/common/SketchListMapView'
import { useAuth } from '../components/common/AuthContext'
import AdmiredPanel from '../components/sketcher/AdmiredPanel'
import EditKitPanel, { KIT_KINDS, isSwatchPaint } from '../components/sketcher/EditKitPanel'
import EditProfilePanel from '../components/sketcher/EditProfilePanel'
import FeaturedSlideshow from '../components/sketcher/FeaturedSlideshow'
import FollowersPanel from '../components/sketcher/FollowersPanel'
import { paintById, paintForKitItem } from '../data/paints'
import { api } from '../lib/api'
import { dateLabel, imageUrl } from '../lib/media'
import { useSketchesVersion } from '../lib/sketchEvents'

/**
 * The sketcher page (design handoff, "Sketcher Page - Editorial"; design
 * doc, item 36). One page, three viewers:
 *
 *   owner    the signed-in sketcher on their own page: Edit profile, Edit
 *            kit, paints, admired sketchers, sketches in progress.
 *   member   signed in, someone else's page: Follow.
 *   visitor  signed out: Follow goes to the login page.
 *
 * Served at /sketchers/:handle, and at / for the signed-in sketcher
 * (HomePage). Sections: hero with the featured slideshow, the kit, admired
 * sketchers (owner only, by decision on October 17, 2026), the sketches.
 */
export default function Sketcher({ handle: handleProp }) {
  const params = useParams()
  const handle = handleProp || params.handle
  const { user, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useSearchParams()
  const sketchesVersion = useSketchesVersion()

  const [page, setPage] = useState(null)
  const [sketches, setSketches] = useState([])
  const [error, setError] = useState(null)
  const [panel, setPanel] = useState(null) // 'profile' | 'kit' | 'admired' | 'followers'
  const [place, setPlace] = useState(null)
  const [busyFollow, setBusyFollow] = useState(false)
  const [paintEdit, setPaintEdit] = useState(null) // { mode, item?, top }
  const paintBoxRef = useRef(null)

  const viewer = page?.is_owner ? 'owner' : user ? 'member' : 'visitor'

  async function load() {
    try {
      const [p, s] = await Promise.all([
        api.get(`/api/sketchers/${handle}`),
        api.get(`/api/sketchers/${handle}/sketches`),
      ])
      setPage(p.data)
      setSketches(s.data)
      setError(null)
    } catch (err) {
      setError(err.response?.status === 404 ? 'not_found' : 'error')
    }
  }

  useEffect(() => { if (handle) load() }, [handle, user?.id, sketchesVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // NavDrawer's "Edit Profile" opens the panel: /?edit=profile.
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
    ...extra,
  })
  const sharedItems = useMemo(() => shared.map((s) => toItem(s)), [shared]) // eslint-disable-line react-hooks/exhaustive-deps

  // Location circles: places by number of sketches, most first.
  const places = useMemo(() => {
    const by = new Map()
    for (const s of shared) {
      if (!s.place) continue
      if (!by.has(s.place)) by.set(s.place, { name: s.place, count: 0, image: imageUrl(s.final_sketch_url || s.reference_image_url) })
      by.get(s.place).count += 1
    }
    return [...by.values()].sort((a, b) => b.count - a.count)
  }, [shared])
  const shownItems = place ? sharedItems.filter((it) => it.place === place) : sharedItems

  if (error === 'not_found') {
    return (
      <div><Header />
        <main className="ed-page"><p className="text-ink/60">No sketcher at @{handle}.</p></main>
      <Footer /></div>
    )
  }
  if (!page) {
    return (
      <div><Header />
        <main className="ed-page"><p className="text-ink/50">{error ? 'Could not load this page.' : 'Loading…'}</p></main>
      <Footer /></div>
    )
  }

  const firstName = (page.display_name || page.handle || '').split(' ')[0]
  const featured = (page.featured?.length ? page.featured : shared.slice(0, 5)).map((s) => ({ ...s, place: s.place || shared.find((x) => x.id === s.id)?.place }))
  const kitByKind = (kind) => page.kit.filter((i) => i.kind === kind)
  const swatchPaints = page.kit.filter(isSwatchPaint)
  const favs = page.favorite_paints || []

  async function toggleFollow() {
    if (viewer === 'visitor') return navigate('/login', { state: { from: location.pathname } })
    setBusyFollow(true)
    try {
      const { data } = page.is_following
        ? await api.delete(`/api/sketchers/${page.handle}/follow`)
        : await api.post(`/api/sketchers/${page.handle}/follow`)
      setPage((p) => ({ ...p, is_following: data.is_following, stats: { ...p.stats, followers: data.followers } }))
    } finally {
      setBusyFollow(false)
    }
  }

  // ---- paints (owner): PaintEditor under the row it edits ----
  function openPaint(mode, item, el) {
    const box = paintBoxRef.current?.getBoundingClientRect()
    const row = el?.closest('[data-paint-row]')?.getBoundingClientRect() || el?.getBoundingClientRect()
    const top = box && row ? row.bottom - box.top + 6 : 0
    const paint = item ? paintForKitItem(item) : null
    setPaintEdit({ mode, item, top, paintId: paint?.id, brand: item?.details?.brand })
  }

  async function savePaint(paintId, brand) {
    const p = paintById(paintId)
    const item = paintEdit.item
    const body = {
      kind: 'color',
      label: p.name,
      pigment_codes: p.codes,
      details: { ...(item?.details || {}), brand },
      medium: item?.medium || null,
      opacity: item?.opacity || null,
      pinned: Boolean(item?.pinned),
      hidden: Boolean(item?.hidden),
    }
    if (item) await api.put(`/api/kit/${item.id}`, body)
    else await api.post('/api/kit', body)
    setPaintEdit(null)
    load()
  }

  async function removePaint(item) {
    await api.delete(`/api/kit/${item.id}`)
    load()
  }

  async function toggleFav(paintId) {
    const next = favs.includes(paintId) ? favs.filter((x) => x !== paintId) : [...favs, paintId]
    setPage((p) => ({ ...p, favorite_paints: next }))
    await api.put('/api/profile', { favorite_paints: next })
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

  return (
    <div className="bg-white">
      <Header />
      <main className="ed-page">
        {/* ---- 1. Hero ---- */}
        <section className="grid items-center gap-7 md:grid-cols-2 md:gap-14">
          <div className="flex flex-col items-center gap-4 text-center md:px-6">
            <span className="ed-kicker">Sketcher{page.location ? ` · ${page.location}` : ''}</span>
            <h1 className="ed-title">{page.display_name || `@${page.handle}`}</h1>
            {page.bio && <p className="m-0 max-w-[420px] text-base leading-normal text-ink/90">{page.bio}</p>}
            <span className="ed-kicker mt-1 tracking-[0.14em]">By @{page.handle}</span>
            {counts}
            <div className="mt-2 flex flex-wrap justify-center gap-2.5">
              {viewer === 'owner' ? (
                <Button variant="editorialSolid" className="min-w-[180px]" onClick={() => setPanel('profile')}>Edit profile</Button>
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

        {/* ---- 2. The kit ---- */}
        <section className="ed-section">
          <div className="ed-section-head">
            <h2 className="ed-kicker m-0">What {firstName} carries</h2>
            {viewer === 'owner' && <Button variant="editorial" onClick={() => setPanel('kit')}>Edit kit</Button>}
          </div>
          <div className="grid gap-8 md:grid-cols-[5fr_6fr] md:gap-14">
            <span className="photo-placeholder relative block aspect-[4/5] w-full overflow-hidden md:aspect-auto md:min-h-[420px]">
              {page.kit_photo_url && <img src={imageUrl(page.kit_photo_url)} alt={`${firstName}'s kit`} className="absolute inset-0 h-full w-full object-cover" />}
              {!page.kit_photo_url && viewer === 'owner' && (
                <span className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink/60">Add a photo of your kit in Edit kit.</span>
              )}
            </span>
            <dl className="m-0 border-t border-[var(--ed-row-rule)]">
              {page.kit.length === 0 && viewer !== 'owner' && <p className="py-4 text-sm text-ink/50">No kit listed yet.</p>}
              {KIT_KINDS.map(({ kind, label }) => {
                const items = kitByKind(kind).filter((i) => !isSwatchPaint(i))
                const showPaints = kind === 'color' && (swatchPaints.length > 0 || viewer === 'owner')
                if (!items.length && !showPaints) return null
                return (
                  <div key={kind} className="ed-row">
                    <dt>{label}</dt>
                    <dd className="flex flex-col gap-1.5">
                      {items.map((i) => (
                        <span key={i.id} className="flex flex-col">
                          <span>{i.label}</span>
                          {i.details?.note && <span className="ed-note">{i.details.note}</span>}
                        </span>
                      ))}
                      {showPaints && (
                        <div ref={paintBoxRef} className="relative flex flex-col gap-1">
                          {swatchPaints.map((i) => {
                            const p = paintForKitItem(i)
                            return (
                              <div key={i.id} data-paint-row className="flex items-center gap-3 py-1">
                                {/* The swatch is data: an inline background. */}
                                <span className="swatch-chip" style={{ background: p?.hex || '#ccc' }} />
                                <span className="w-[72px] shrink-0 text-xs font-bold">{p?.code || i.pigment_codes[0]}</span>
                                <span className="flex min-w-0 flex-1 flex-col">
                                  <span className="truncate">{p?.name || i.label}</span>
                                  {i.details?.brand && <span className="text-xs text-ink/50">{i.details.brand}</span>}
                                </span>
                                {viewer === 'owner' && (
                                  <>
                                    <button type="button" className="ed-icon-btn" aria-label={`Change ${p?.name || i.label}`} onClick={(e) => openPaint('edit', i, e.currentTarget)}>
                                      <Icon name="edit" size={14} />
                                    </button>
                                    <button type="button" className="ed-icon-btn" aria-label={`Remove ${p?.name || i.label}`} onClick={() => removePaint(i)}>
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
                              brand={paintEdit.brand}
                              showBrand
                              favs={favs}
                              top={paintEdit.top}
                              onSave={savePaint}
                              onClose={() => setPaintEdit(null)}
                              onToggleFav={toggleFav}
                            />
                          )}
                        </div>
                      )}
                    </dd>
                  </div>
                )
              })}
              {page.kit.length === 0 && viewer === 'owner' && (
                <p className="py-4 text-sm text-ink/60">List your pens, paper and brushes in Edit kit, and add your paints above.</p>
              )}
            </dl>
          </div>
        </section>

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
              <p className="text-sm text-ink/60">Add the sketchers you learn from. When you upload a final sketch, one of them can give your feedback.</p>
            )}
          </section>
        )}

        {/* ---- 4. The sketches ---- */}
        <section className="ed-section">
          <h2 className="ed-kicker m-0">The sketches</h2>
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
          <SketchListMapView items={shownItems} pinMode="place" onPlaceSelect={setPlace}
            emptyText={viewer === 'owner' ? 'Your sketches show here once you upload their final sketch.' : 'No shared sketches yet.'} />
        </section>

        {/* ---- 5. In progress (owner only) ---- */}
        {viewer === 'owner' && inProgress.length > 0 && (
          <section className="ed-section">
            <div className="ed-section-head">
              <h2 className="ed-kicker m-0">In progress</h2>
              <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
                <Icon name="lock" size={13} /> Only you
              </span>
            </div>
            <SketchListMapView cols={4}
              items={inProgress.map((s) => toItem(s, { meta: 'Sketching…', href: `/sketches/${s.id}/edit`, linkState: { backgroundLocation: location } }))} />
          </section>
        )}
      </main>
      <Footer />

      {panel === 'profile' && (
        <EditProfilePanel
          profile={page}
          userId={user?.id}
          shared={shared.map((s) => ({ id: s.id, title: s.title, image: imageUrl(s.final_sketch_url || s.reference_image_url) }))}
          onClose={() => setPanel(null)}
          onSaved={async (data) => {
            setPanel(null)
            await refreshProfile?.()
            if (params.handle && data.handle !== params.handle) navigate(`/sketchers/${data.handle}`, { replace: true })
            else load()
          }}
        />
      )}
      {panel === 'kit' && (
        <EditKitPanel items={page.kit} kitPhotoUrl={page.kit_photo_url} onClose={() => { setPanel(null); load() }} onSaved={() => { setPanel(null); load() }} />
      )}
      {panel === 'admired' && (
        <AdmiredPanel list={page.admired || []} onClose={() => setPanel(null)} onChange={(list) => setPage((p) => ({ ...p, admired: list }))} />
      )}
      {panel === 'followers' && <FollowersPanel handle={page.handle} onClose={() => setPanel(null)} />}
    </div>
  )
}
