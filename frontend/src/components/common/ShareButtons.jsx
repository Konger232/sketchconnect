import { useEffect, useRef, useState } from 'react'
import Button from './Button'
import Icon from './Icon'
import { phone, shareToFacebook, shareToInstagram } from '../../lib/shareSketch'

/**
 * Share in one tap (November 16, 2026): an icon each for Facebook and
 * Instagram (lib/shareSketch.js says what each does). What will happen is
 * said before the tap and after it (November 16, 2026): on a computer, a
 * tooltip on hover; on a phone, a line under the icons. After a tap, a line
 * says what happened.
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
  const onPhone = phone()

  useEffect(() => {
    let live = true
    const t = setTimeout(() => { makeFiles().then((f) => live && setFiles(f)).catch(() => live && setFiles([])) }, 800)
    return () => { live = false; clearTimeout(t) }
  }, [makeFiles])

  const say = (text) => {
    setNote(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setNote(null), 10000)
  }

  async function facebook() {
    const copied = await shareToFacebook(link, captions.facebook)
    say(copied ? 'Facebook opened in a new tab. Your caption is copied: paste it in the post.' : 'Facebook opened in a new tab.')
  }
  async function instagram() {
    if (!files?.length) return
    const said = await shareToInstagram(files, captions.instagram, title)
    if (said) say(said)
  }

  const n = files?.length || 0
  const images = `${n} ${n === 1 ? 'image' : 'images'}`
  const tips = {
    facebook: 'Opens Facebook in a new tab with a link to this page. Your caption is copied: paste it in the post.',
    instagram: !files ? 'Preparing the images…'
      : !n ? 'Add a picture to share on Instagram.'
      : `Saves ${images} to your Downloads folder, copies your caption and opens Instagram. Start a new post with the images, then paste the caption.`,
  }

  // The same outlined button as Edit and Upload sketch, square.
  const btn = 'w-11 !px-0 disabled:cursor-wait disabled:opacity-50'
  // A computer: the tip shows on hover (or keyboard focus), under the icon.
  const tip = (text) => (
    <span role="tooltip"
      className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-64 rounded-md bg-ink px-3 py-2 text-xs leading-snug text-white shadow-lg [@media(hover:hover)]:group-hover:block [@media(hover:hover)]:group-focus-within:block">
      {text}
    </span>
  )
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-2">
        <span className="group relative">
          <Button variant="editorial" className={btn} onClick={facebook} aria-label={`Share on Facebook. ${tips.facebook}`}>
            <Icon name="facebook" size={18} />
          </Button>
          {tip(tips.facebook)}
        </span>
        <span className="group relative">
          <Button variant="editorial" className={btn} onClick={instagram} disabled={!n}
            aria-label={`Share on Instagram. ${tips.instagram}`}>
            <Icon name="instagram" size={18} />
          </Button>
          {tip(tips.instagram)}
        </span>
      </div>
      {note
        ? <p className="m-0 max-w-xs text-xs text-ink/70" role="status">{note}</p>
        : onPhone && <p className="m-0 max-w-xs text-xs text-ink/60">Your caption is copied when you share: paste it in your post.</p>}
    </div>
  )
}
