import { Link } from 'react-router-dom'
import BasePage from '../components/common/BasePage'

const GLAZE = 'https://glaze.cs.uchicago.edu/'

const PROTECTIONS = [
  'You choose who sees each finished sketch: all sketchers, only your followers, or only you. Your plans and progress pages stay yours until you share the final.',
  'Only signed-in sketchers see your work in full. Visitors see a small part of a finished sketch, never your plans or your progress pages.',
  'We show a smaller copy of each image, never your original file. The location and camera details from your photo are removed.',
  'Your name and a copyright note are written into every copy.',
  'Image links expire within two hours, so a copied link stops working.',
  'We ask AI crawlers to stay out, and search engines not to index images.',
  'Right-click and long-press saving are turned off on images.',
]

const ASKS = [
  "Look, learn and comment. Don't download, repost, trace or share another sketcher's work outside SketchConnect without their permission.",
  "Never put another sketcher's work into an AI tool.",
  'Credit the sketcher when their work inspires yours.',
  'Be kind to work in progress. A rough plan is a brave thing to share.',
]

/**
 * "Your work is yours" (design doc: protecting sketchers' work, October
 * 22, 2026). What SketchConnect promises, how it protects sketchers' work,
 * and what it asks of every sketcher. Public: linked from the footer, the
 * upload screen and every sketch page (RightsNote).
 */
export default function YourWork() {
  return (
    <BasePage>
      <section className="flex max-w-3xl flex-col gap-4">
        <span className="ed-kicker">Respecting sketchers' work</span>
        <h1 className="ed-title">Your work is yours</h1>
        <p className="m-0 text-lg text-ink/80">
          SketchConnect is a place to learn in the open. Your rough plans, your half-finished pages and your final
          sketch all show how you see. Sharing them takes trust. Here is how we keep it.
        </p>
      </section>

      <section className="ed-section max-w-3xl">
        <h2 className="ed-kicker m-0">What we promise</h2>
        <p className="m-0 text-base text-ink/80">
          You own everything you upload: your photos, plans, progress pages and final sketches. Posting here lets
          SketchConnect show your work to signed-in sketchers, and nothing more. We don't sell your work. We don't
          use it to train AI. The AI coach reads your sketch only to give you feedback.
        </p>
      </section>

      <section className="ed-section max-w-3xl">
        <h2 className="ed-kicker m-0">How we protect it</h2>
        <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-base text-ink/80">
          {PROTECTIONS.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </section>

      <section className="ed-section max-w-3xl">
        <h2 className="ed-kicker m-0">What we ask of every sketcher</h2>
        <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-base text-ink/80">
          {ASKS.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </section>

      <section className="ed-section max-w-3xl">
        <h2 className="ed-kicker m-0">What no website can promise</h2>
        <p className="m-0 text-base text-ink/80">
          Anything a screen shows can be photographed. We make copying hard and keep your name on your work, but we
          can't make it impossible. For work that matters most, you can protect the image itself with{' '}
          <a href={GLAZE} target="_blank" rel="noreferrer" className="underline">Glaze</a>, a free tool from the
          University of Chicago, before you upload it, then tick "My final sketch is Glazed" in the sketch's Details so others know.
        </p>
      </section>

      <section className="ed-section max-w-3xl">
        <h2 className="ed-kicker m-0">If you see your work misused</h2>
        <p className="m-0 text-base text-ink/80">
          Tell us through the <Link to="/contact" className="underline">Contact</Link> page, with a link to where
          it appeared. We will look into it and help you ask for it to be taken down.
        </p>
      </section>
    </BasePage>
  )
}
