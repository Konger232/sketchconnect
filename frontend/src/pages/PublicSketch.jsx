import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import BasePage, { PageMessage } from '../components/common/BasePage'
import Avatar from '../components/common/Avatar'
import Button from '../components/common/Button'
import Icon from '../components/common/Icon'
import NameHandle from '../components/common/NameHandle'
import RightsNote from '../components/common/RightsNote'
import { api } from '../lib/api'
import { dateLabel, imageUrl } from '../lib/media'

/**
 * A shared sketch for someone who isn't signed in (November 16, 2026): the
 * page a Facebook, WhatsApp or LINE link opens (sketchconnect.web.app/s/<id>
 * forwards here). The final sketch, its title, place and sketcher, and an
 * invitation to join. The rest of the sketch page (the reference, the plan,
 * the progress sketches, the comments) stays for members.
 */
export default function PublicSketch() {
  const { sketchId } = useParams()
  const location = useLocation()
  const [s, setS] = useState(undefined) // undefined: loading; null: not shared

  useEffect(() => {
    api.get(`/api/public/sketches/${sketchId}`).then(({ data }) => setS(data)).catch(() => setS(null))
  }, [sketchId])

  if (s === undefined) return <PageMessage muted>Loading…</PageMessage>
  if (s === null) {
    return (
      <PageMessage>
        This sketch isn't shared publicly. <Link to="/login" state={{ from: location.pathname }} className="underline">Sign in</Link> to see it.
      </PageMessage>
    )
  }

  const name = s.owner?.display_name || s.owner?.username
  const join = { pathname: '/login', search: '?mode=register' }

  return (
    <BasePage detail>
      <section className="flex flex-col gap-2.5">
        <span className="ed-kicker">Sketch</span>
        <h1 className="ed-title">{s.title || 'Untitled sketch'}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-base">
          <span className="flex items-center gap-2">
            <Avatar url={s.owner?.avatar_url} className="h-8 w-8" />
            {s.owner?.username ? <NameHandle person={s.owner} /> : 'A sketcher'}
          </span>
          {s.date && <span className="text-ink/80">{dateLabel(s.date)}</span>}
          {s.place && (
            <span className="inline-flex items-center gap-1.5 text-ink/80">
              <Icon name="location" size={14} className="text-[var(--pin-active)]" /> {s.place}
            </span>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="ed-bleed flex justify-center bg-[var(--ed-field-bg)] md:bg-black">
          <img src={imageUrl(s.image)} alt={s.title || 'Sketch'} className="block w-full md:max-h-[640px] md:w-auto md:max-w-full" />
        </div>
        <RightsNote name={name} />
      </section>

      <section className="ed-section">
        <div className="flex flex-col items-start gap-4 rounded-lg bg-[var(--ed-field-bg)] p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 font-heading text-xl font-bold">Join SketchConnect</h2>
            <p className="m-0 text-sm text-ink/75">
              See how {name || 'the sketcher'} made it: the scene, the plan and the sketches along the way.
              Share your own sketches and meet sketchers near you.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link to={join} state={{ from: location.pathname }}><Button variant="editorialSolid">Join SketchConnect</Button></Link>
            <Link to="/login" state={{ from: location.pathname }}><Button variant="editorial">Sign in</Button></Link>
          </div>
        </div>
      </section>
    </BasePage>
  )
}
