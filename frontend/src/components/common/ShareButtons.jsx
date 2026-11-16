import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { shareToFacebook, shareToInstagram } from '../../lib/shareSketch'

/**
 * Share in one tap (November 16, 2026): an icon each for Facebook and
 * Instagram, and a one-line note after a tap. See lib/shareSketch.js for
 * what each does.
 *
 *   link       the address to share (/s/<id> or /e/<id>: a card with a picture)
 *   captions   { facebook, instagram }
 *   makeFiles  async () => [File]: the Instagram images. Made as the page
 *              opens, since a phone's share sheet must open straight after
 *              the tap.
 *   title      the share sheet's title
 */
export default function ShareButtons({ link, captions, makeFiles, title }) {
  const [files, setFiles] = useState(null)
  const [note, setNote] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    let live = true
    const t = setTimeout(() => { makeFiles().then((f) => live && setFiles(f)).catch(() => live && setFiles([])) }, 800)
    return () => { live = false; clearTimeout(t) }
  }, [makeFiles])

  const say = (text) => {
    setNote(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setNote(null), 6000)
  }

  async function facebook() {
    const copied = await shareToFacebook(link, captions.facebook)
    say(copied ? 'Caption copied: paste it in Facebook’s post box.' : 'Facebook opened in a new window.')
  }
  async function instagram() {
    if (!files?.length) return
    const said = await shareToInstagram(files, captions.instagram, title)
    if (said) say(said)
  }

  const btn = 'flex h-10 w-10 items-center justify-center rounded-md border border-ink/20 bg-white text-ink hover:border-ink disabled:cursor-wait disabled:opacity-50'
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={facebook} aria-label="Share on Facebook" title="Share on Facebook">
          <Icon name="facebook" size={18} />
        </button>
        <button type="button" className={btn} onClick={instagram} disabled={!files?.length}
          aria-label={!files ? 'Preparing the images for Instagram' : files.length ? 'Share on Instagram' : 'No picture to share on Instagram'}
          title={files && !files.length ? 'Add a picture to share on Instagram' : 'Share on Instagram'}>
          <Icon name="instagram" size={18} />
        </button>
      </div>
      {note && <p className="m-0 text-xs text-ink/70" role="status">{note}</p>}
    </div>
  )
}
