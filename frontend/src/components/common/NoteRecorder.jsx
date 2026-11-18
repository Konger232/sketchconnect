import { useEffect, useRef, useState } from 'react'
import Button from './Button'
import FloatPanel from './FloatPanel'

/**
 * Records a voice note or a short clip in the page (November 18, 2026), so
 * the length and the file size stay in hand: a voice note up to 5 minutes,
 * a clip up to 30 seconds at a modest quality (about 10 MB). The browser
 * asks for the microphone (and the camera, for a clip) the first time.
 *
 *   kind      'voice' | 'clip'
 *   onDone({ blob, type, seconds })   after Stop (or the time limit)
 *   onClose
 */
const LIMIT = { voice: 300, clip: 30 }
const TYPES = {
  voice: ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'],
  clip: ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'],
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function NoteRecorder({ kind, onDone, onClose }) {
  const [state, setState] = useState('starting') // starting | recording | error
  const [error, setError] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const stream = useRef(null)
  const recorder = useRef(null)
  const chunks = useRef([])
  const started = useRef(0)
  const preview = useRef(null)

  useEffect(() => {
    let live = true
    async function start() {
      try {
        const s = await navigator.mediaDevices.getUserMedia(kind === 'clip'
          ? { audio: true, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } }
          : { audio: true })
        if (!live) return s.getTracks().forEach((t) => t.stop())
        stream.current = s
        if (preview.current) preview.current.srcObject = s
        const type = TYPES[kind].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || ''
        const rec = new MediaRecorder(s, {
          ...(type ? { mimeType: type } : {}),
          ...(kind === 'clip' ? { videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 96_000 } : { audioBitsPerSecond: 64_000 }),
        })
        rec.ondataavailable = (e) => { if (e.data?.size) chunks.current.push(e.data) }
        rec.onstop = () => {
          const blobType = (rec.mimeType || type || (kind === 'clip' ? 'video/mp4' : 'audio/mp4')).split(';')[0]
          const blob = new Blob(chunks.current, { type: blobType })
          s.getTracks().forEach((t) => t.stop())
          if (live) onDone({ blob, type: blobType, seconds: Math.round((Date.now() - started.current) / 1000) })
        }
        recorder.current = rec
        started.current = Date.now()
        rec.start(1000)
        setState('recording')
      } catch (err) {
        setState('error')
        setError(err?.name === 'NotAllowedError'
          ? `SketchConnect needs your ${kind === 'clip' ? 'camera and microphone' : 'microphone'}. Allow it in the browser's settings for this site, then try again.`
          : 'Recording is not available in this browser.')
      }
    }
    start()
    return () => {
      live = false
      if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop() }
      stream.current?.getTracks().forEach((t) => t.stop())
    }
  }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps

  // The clock, and the stop at the time limit.
  useEffect(() => {
    if (state !== 'recording') return undefined
    const t = setInterval(() => {
      const s = (Date.now() - started.current) / 1000
      setSeconds(s)
      if (s >= LIMIT[kind]) stop()
    }, 250)
    return () => clearInterval(t)
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  const footer = state === 'recording' ? (
    <div className="flex w-full items-center justify-between gap-2">
      <Button variant="editorial" size="sm" onClick={onClose}>Cancel</Button>
      <Button variant="editorialSolid" size="sm" onClick={stop}>Stop and save</Button>
    </div>
  ) : (
    <div className="flex w-full justify-end"><Button variant="editorial" size="sm" onClick={onClose}>Close</Button></div>
  )

  return (
    <FloatPanel placement="modal" title={kind === 'clip' ? 'Record a clip' : 'Record a voice note'} onClose={onClose} footer={footer} closeOnOutside={false}>
      <div className="flex flex-col items-center gap-4 py-2">
        {kind === 'clip' && (
          <video ref={preview} autoPlay muted playsInline className="aspect-video w-full rounded-md bg-black object-cover" />
        )}
        {state === 'error' ? (
          <p className="m-0 text-sm text-accent">{error}</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${state === 'recording' ? 'animate-pulse bg-red-600' : 'bg-ink/30'}`} />
              <span className="font-heading text-3xl tabular-nums">{clock(seconds)}</span>
              <span className="text-sm text-ink/60">of {clock(LIMIT[kind])}</span>
            </div>
            <p className="m-0 text-center text-sm text-ink/70">
              {state === 'starting' ? 'Starting…'
                : kind === 'clip' ? 'Recording the scene. It stops by itself at 30 seconds.'
                : 'Speak about the place, the light, what is happening. Only you will hear it.'}
            </p>
          </>
        )}
      </div>
    </FloatPanel>
  )
}
