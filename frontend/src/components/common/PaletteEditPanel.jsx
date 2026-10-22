import { useEffect, useMemo, useRef, useState } from 'react'
import GamutWheel from '../analysis/GamutWheel'
import Button from './Button'
import FloatPanel from './FloatPanel'
import Icon from './Icon'
import NewPaintForm from './NewPaintForm'
import PanGrid from './PanGrid'
import { STARTER_PALETTE, libraryPaints, paintById, paintLabel, registerPaints } from '../../data/paints'
import { api } from '../../lib/api'
import { paintToWheel, wheelToHex } from '../../lib/colorWheel'
import {
  canMerge, defaultLayout, dropPaint, emptyPan, firstFree, mergePan, nearestPaints, panAt,
  placePaint, placed, resize, splitPan, swapPaint, MAX_COLS, MAX_ROWS,
} from '../../lib/paletteLayout'
import { useSheetDrag } from '../../lib/useSheetDrag'
import { useWide } from '../../lib/useWide'

const DRAG_START = 5 // px before a press becomes a drag
const CARD_W = 320

/**
 * Edit palette (design doc, item 45). The paints on the Yurmby wheel, with
 * the palette as chips on top, and the pans laid out like the tin.
 *
 *   tap the wheel        add a paint near that colour (our list, nearest first)
 *   tap a paint          change it or take it out
 *   drag a paint         onto a pan; pan to pan swaps; off the tin empties it
 *   tap a pan            make it a full pan (right or down), a half pan, or empty
 *
 * The form floats beside the wheel on a computer (drag its title to move it)
 * and is the white bottom sheet on a phone. Every change saves at once.
 */
export default function PaletteEditPanel({ paints: startPaints, layout: startLayout, onClose }) {
  const starter = !startPaints?.length
  const [paints, setPaints] = useState(starter ? STARTER_PALETTE : startPaints)
  const [layout, setLayout] = useState(() => startLayout || defaultLayout(starter ? STARTER_PALETTE : startPaints))
  // { mode: 'add', at: { h, c } | null } | { mode: 'edit', id } | { mode: 'new', at, tapped }
  // (`tapped`: the sketcher set the new paint's colour on the wheel)
  const [form, setForm] = useState(null)
  const [libTick, setLibTick] = useState(0) // the library has loaded (lib/api.js registers it)
  const [flag, setFlag] = useState(null) // Report a mistake: { note, sent }
  const [pending, setPending] = useState(null)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(null) // the pan picked { r, c }
  const [ghost, setGhost] = useState(null) // { hex, x, y } while dragging a paint
  const [dropAt, setDropAt] = useState(null)
  const [cardPos, setCardPos] = useState(null) // { x, y } in the stage
  const [error, setError] = useState(null)
  const wide = useWide()
  const stageRef = useRef(null)
  const wheelRef = useRef(null)
  const press = useRef(null)
  const [sheetOpen, setSheetOpen] = useState(true)
  const sheet = useSheetDrag(sheetOpen, setSheetOpen, '.pal-sheet-title')

  useEffect(() => { api.get('/api/paints').then(() => setLibTick((t) => t + 1)).catch(() => {}) }, [])

  const list = useMemo(() => paints.map(paintById).filter(Boolean), [paints, libTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const inPans = placed(layout)

  async function save(nextPaints, nextLayout) {
    setPaints(nextPaints)
    setLayout(nextLayout)
    setError(null)
    try {
      await api.put('/api/palette', { paints: nextPaints, layout: nextLayout })
    } catch {
      setError('Could not save the palette. Check your connection and try again.')
    }
  }

  // ---- the form ----
  function openForm(next, anchorXY) {
    setForm(next)
    setQuery('')
    setFlag(null)
    setSheetOpen(true)
    if (next.mode === 'edit') setPending(next.id)
    else setPending(next.at ? nearestPaints(next.at).find((p) => !paints.includes(p.id))?.id || null : null)
    // Beside the wheel, level with the spot tapped.
    const stage = stageRef.current?.getBoundingClientRect()
    const wheel = wheelRef.current?.getBoundingClientRect()
    if (stage && wheel) {
      const y = (anchorXY?.y ?? wheel.top + wheel.height / 2) - stage.top - 60
      setCardPos({ x: Math.min(wheel.right - stage.left + 12, stage.width - CARD_W), y: Math.max(0, Math.min(y, stage.height - 360)) })
    }
  }
  const anchor = form ? (form.mode === 'edit' ? paintToWheel(paintById(form.id)?.hex || '#808080') : form.at) : null
  const candidates = useMemo(() => {
    if (!form) return []
    const q = query.trim().toLowerCase()
    return (anchor ? nearestPaints(anchor) : libraryPaints()).filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
  }, [form, anchor?.h, anchor?.c, query, libTick]) // eslint-disable-line react-hooks/exhaustive-deps

  function addPaint(id = pending) {
    if (!id || paints.includes(id)) return
    const free = firstFree(layout)
    save([...paints, id], free ? placePaint(layout, free, id) : layout)
    setForm(null)
  }
  // A new paint: the server has put it in the library and my palette.
  function addedNew(paint) {
    registerPaints([paint])
    setLibTick((t) => t + 1)
    addPaint(paint.id)
  }
  async function sendFlag() {
    try {
      await api.post(`/api/paints/${form.id}/flag`, { note: flag.note })
      setFlag({ ...flag, sent: true })
    } catch {
      setError('Could not send the report. Try again.')
    }
  }
  function changePaint() {
    const was = form.id
    if (!pending || pending === was) return setForm(null)
    if (paints.includes(pending)) return
    save(paints.map((x) => (x === was ? pending : x)), swapPaint(layout, was, pending))
    setForm(null)
  }
  function removePaint(id) {
    save(paints.filter((x) => x !== id), dropPaint(layout, id))
    setForm(null)
    setSel(null)
  }

  // ---- dragging a paint (from the wheel, a chip or a pan) ----
  function startPress(e, id, from = null) {
    e.preventDefault()
    press.current = { id, from, sx: e.clientX, sy: e.clientY, moved: false }
    const move = (ev) => {
      const p = press.current
      if (!p) return
      if (!p.moved && Math.hypot(ev.clientX - p.sx, ev.clientY - p.sy) < DRAG_START) return
      p.moved = true
      if (p.id) setGhost({ hex: paintById(p.id)?.hex, x: ev.clientX, y: ev.clientY })
      const cell = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-pan]')?.dataset.pan
      setDropAt(cell ? { r: +cell.split(',')[0], c: +cell.split(',')[1] } : null)
    }
    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const p = press.current
      press.current = null
      setGhost(null)
      setDropAt(null)
      if (!p) return
      if (!p.moved) {
        // A tap: a pan is picked; a paint opens its form.
        // A tap: a pan is picked (its paint ringed on the wheel); a paint
        // opens its form and picks its pan.
        if (p.from) { setSel(p.from); setForm(null) } else if (p.id) {
          const home = layout.pans.find((x) => x.paint === p.id)
          setSel(home ? { r: home.r, c: home.c } : null)
          openForm({ mode: 'edit', id: p.id }, { y: ev.clientY })
        }
        return
      }
      const cell = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-pan]')?.dataset.pan
      if (cell) {
        const [r, c] = cell.split(',').map(Number)
        if (p.id) save(paints, placePaint(layout, { r, c }, p.id, p.from))
        setSel({ r, c })
      } else if (p.from) {
        const pan = panAt(layout, p.from.r, p.from.c)
        if (pan) save(paints, emptyPan(layout, pan)) // dragged off the tin
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  // ---- the picked pan ----
  const pan = sel ? panAt(layout, sel.r, sel.c) || { ...sel, w: 1, h: 1, paint: null } : null
  const panPaint = pan?.paint ? paintById(pan.paint) : null
  // The paint in focus, ringed on the wheel and outlined in the chips.
  const focusId = form?.mode === 'edit' ? form.id : panPaint?.id || null
  useEffect(() => { if (sel && (sel.r >= layout.rows || sel.c >= layout.cols)) setSel(null) }, [layout, sel])

  // The floating card's title drags it (computer).
  function dragCard(e) {
    const el = e.currentTarget
    const start = { x: e.clientX, y: e.clientY, pos: cardPos }
    el.setPointerCapture(e.pointerId)
    const move = (ev) => setCardPos({ x: start.pos.x + ev.clientX - start.x, y: start.pos.y + ev.clientY - start.y })
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const formBody = form && (
    <>
      <div className={`flex items-center gap-3 ${wide ? 'cursor-move select-none touch-none' : 'pal-sheet-title'} pb-1`} onPointerDown={wide ? dragCard : undefined}>
        {form.mode !== 'edit' && !form.at
          ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/20"><Icon name="plus" size={14} /></span>
          : <span className="h-7 w-7 shrink-0 rounded-full border border-black/10" style={{ background: form.mode === 'edit' ? paintById(form.id)?.hex : wheelToHex(form.at) }} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="ed-caption">{{ add: 'Add a paint', edit: 'Change or remove', new: 'New paint' }[form.mode]}</span>
          <span className="truncate text-sm font-semibold">
            {form.mode === 'edit' ? paintLabel(paintById(form.id)) : form.mode === 'new' ? 'Not in the library yet' : form.at ? 'Paints near this colour' : 'Pick a paint'}
          </span>
        </span>
        {wide && (
          <button type="button" className="ed-icon-btn -mr-2 h-8 w-8" aria-label="Close" onPointerDown={(e) => e.stopPropagation()} onClick={() => setForm(null)}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {form.mode === 'new' ? (
        <div className="pal-fields">
          <NewPaintForm at={form.at} tapped={form.tapped} onSuggest={(at) => setForm((f) => (f?.mode === 'new' && !f.tapped ? { ...f, at } : f))} mine={paints} onUse={(id) => addPaint(id)} onSaved={addedNew} onCancel={() => setForm(null)} />
        </div>
      ) : (
      <div className="pal-fields flex min-h-0 flex-col gap-2">
        <label className="flex items-center gap-2 rounded-lg border border-ink/20 px-3 py-2">
          <Icon name="search" size={14} className="text-ink/60" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search paint or pigment code" className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none" />
        </label>
        <ul className="m-0 max-h-[220px] list-none overflow-y-auto p-0">
          {candidates.map((p) => {
            const mine = paints.includes(p.id) && p.id !== form.id
            return (
              <li key={p.id}>
                <button type="button" disabled={mine} onClick={() => setPending(p.id)} aria-pressed={pending === p.id}
                  className={`flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left ${pending === p.id ? 'bg-[var(--ed-field-bg)]' : 'hover:bg-ink/5'} ${mine ? 'opacity-40' : ''}`}>
                  <span className="h-5 w-5 shrink-0 rounded-full border border-black/10" style={{ background: p.hex }} />
                  <span className="w-14 shrink-0 text-[11px] font-bold">{p.code}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{paintLabel(p)}</span>
                    <span className="truncate text-[11px] text-ink/55">
                      {mine ? 'In your palette' : p.added_by && !p.checked ? `Added by @${p.added_by}` : p.lean}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <button type="button" className="self-start text-xs font-semibold underline"
          onClick={() => setForm({ mode: 'new', at: form.mode === 'add' ? form.at : null, tapped: form.mode === 'add' && Boolean(form.at) })}>
          Not on the list? Add a new paint
        </button>
        {form.mode === 'edit' && (flag ? (
          flag.sent ? <p className="m-0 text-xs text-ink/60">Thanks. We'll check it.</p> : (
            <div className="flex flex-col gap-1.5">
              <textarea rows={2} value={flag.note} onChange={(e) => setFlag({ ...flag, note: e.target.value })} maxLength={300}
                placeholder="What's wrong? e.g. the pigment is PB15:3, not PB15" className="field-input resize-y !py-2 text-xs" />
              <span className="flex justify-end gap-2">
                <button type="button" className="text-xs underline" onClick={() => setFlag(null)}>Cancel</button>
                <button type="button" className="text-xs font-semibold underline" onClick={sendFlag}>Send report</button>
              </span>
            </div>
          )
        ) : (
          <button type="button" className="self-start text-xs text-ink/60 underline" onClick={() => setFlag({ note: '' })}>Report a mistake in this paint</button>
        ))}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {form.mode === 'edit' && <Button variant="editorial" size="sm" onClick={() => removePaint(form.id)}>Remove</Button>}
          <Button variant="editorial" size="sm" onClick={() => setForm(null)}>Cancel</Button>
          {form.mode === 'add'
            ? <Button variant="editorialSolid" size="sm" disabled={!pending} onClick={() => addPaint()}>Add paint</Button>
            : <Button variant="editorialSolid" size="sm" disabled={!pending || pending === form.id} onClick={changePaint}>Save</Button>}
        </div>
      </div>
      )}
    </>
  )

  const stepper = (label, value, set, max) => (
    <span className="flex items-center gap-1.5 text-sm">
      <span className="text-ink/70">{label}</span>
      <button type="button" className="ed-icon-btn !h-8 !w-8 border border-ink/20" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= 1} onClick={() => set(value - 1)}>−</button>
      <span className="w-5 text-center font-semibold">{value}</span>
      <button type="button" className="ed-icon-btn !h-8 !w-8 border border-ink/20" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => set(value + 1)}>+</button>
    </span>
  )

  return (
    <FloatPanel
      placement="modal"
      title="Edit palette"
      width="900px"
      onClose={() => onClose()}
      footer={
        <>
          {error && <span className="mr-auto text-sm text-accent">{error}</span>}
          <Button variant="action" onClick={() => onClose()}>Done</Button>
        </>
      }
    >
      <p className="m-0 text-sm text-ink/70">
        {starter ? 'This is the starter palette. Change it to the paints you carry. ' : ''}
        Tap the wheel to add a paint near that colour; tap a paint to change it. Is there a warm and a cool of each primary? Then drag each paint into its pan, laid out like your tin. Changes save as you go.
      </p>

      {/* The palette, on top: drag a chip onto a pan, or tap it. */}
      <div className="flex flex-wrap gap-2">
        {list.map((p) => (
          <button key={p.id} type="button" onPointerDown={(e) => startPress(e, p.id)} aria-label={`${p.name}: tap to change, drag onto a pan`}
            className={`flex touch-none items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs ${focusId === p.id ? 'border-ink ring-1 ring-ink' : 'border-ink/20'} ${inPans.has(p.id) ? '' : 'border-dashed'}`}>
            <span className="h-5 w-5 rounded-full border border-black/10" style={{ background: p.hex }} />
            <span className="font-bold">{p.code}</span>
          </button>
        ))}
        <Button variant="editorial" size="sm" onClick={() => openForm({ mode: 'add', at: null })}>
          <Icon name="plus" size={14} /> Add paint
        </Button>
      </div>

      <div ref={stageRef} className="relative grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div ref={wheelRef} className="pb-4">
          <GamutWheel paints={list} readOnly light ringPaint={focusId}
            selected={form && form.mode !== 'edit' ? form.at : null}
            onTapWheel={(at) => (form?.mode === 'new' ? setForm({ ...form, at, tapped: true }) : openForm({ mode: 'add', at }))}
            onPaintDown={(p, e) => startPress(e, p.id)} />
        </div>

        <div className="flex flex-col gap-3">
          <span className="ed-caption">Your tin</span>
          <div className="flex flex-wrap gap-4">
            {stepper('Rows', layout.rows, (n) => save(paints, resize(layout, n, layout.cols)), MAX_ROWS)}
            {stepper('Columns', layout.cols, (n) => save(paints, resize(layout, layout.rows, n)), MAX_COLS)}
          </div>
          <div>
            <PanGrid layout={layout} editable selected={sel} dropAt={dropAt}
              onPanDown={(p, e) => startPress(e, p.paint, { r: p.r, c: p.c })} />
          </div>
          {pan ? (
            <div className="flex flex-col gap-2 border-t border-[var(--ed-row-rule)] pt-3">
              <span className="text-sm">
                <span className="font-semibold">{pan.w * pan.h > 1 ? 'Full pan' : 'Half pan'}</span>
                {panPaint ? ` · ${panPaint.code} ${panPaint.name}` : ' · empty'}
              </span>
              <div className="flex flex-wrap gap-2">
                {pan.w * pan.h === 1 ? (
                  <>
                    <Button variant="editorial" size="sm" disabled={!canMerge(layout, pan, 'right')} onClick={() => save(paints, mergePan(layout, pan, 'right'))}>Full pan →</Button>
                    <Button variant="editorial" size="sm" disabled={!canMerge(layout, pan, 'down')} onClick={() => save(paints, mergePan(layout, pan, 'down'))}>Full pan ↓</Button>
                  </>
                ) : (
                  <Button variant="editorial" size="sm" onClick={() => save(paints, splitPan(layout, panAt(layout, pan.r, pan.c)))}>Half pan</Button>
                )}
                {panPaint && <Button variant="editorial" size="sm" onClick={() => save(paints, emptyPan(layout, panAt(layout, pan.r, pan.c)))}>Take out of the pan</Button>}
                {panPaint && <Button variant="editorial" size="sm" onClick={() => { removePaint(panPaint.id) }}>Remove from palette</Button>}
              </div>
              {pan.w * pan.h === 1 && !canMerge(layout, pan, 'right') && !canMerge(layout, pan, 'down') && (
                <span className="text-xs text-ink/55">A full pan takes the empty half pan to its right or below.</span>
              )}
            </div>
          ) : (
            <span className="text-xs text-ink/55">Drag a paint onto a pan. Tap a pan to make it a full pan or remove its paint. Dragging a paint off the tin only takes it out of its pan; a dashed chip is a paint in no pan.</span>
          )}
        </div>

        {/* The form: a card beside the wheel (computer). */}
        {form && wide && cardPos && (
          <div className="absolute z-30 flex flex-col gap-2 rounded-lg bg-white p-3 shadow-[0_4px_24px_rgba(0,0,0,0.25)]"
            style={{ left: cardPos.x, top: cardPos.y, width: CARD_W }}>
            {formBody}
          </div>
        )}
      </div>

      {/* The form: the white bottom sheet (phone). */}
      {form && !wide && (
        <div ref={sheet.ref} className={`sc-sheet flex flex-col bg-white max-md:!z-[1600] ${sheet.className} ${sheetOpen ? '' : '[&_.pal-fields]:hidden'}`} style={sheet.style}>
          <button type="button" className="sc-sheet-handle touch-none" {...sheet.handleProps}
            aria-label={sheetOpen ? 'Fold the form down' : 'Open the form'} aria-expanded={sheetOpen}>
            <span />
          </button>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4">{formBody}</div>
        </div>
      )}

      {/* The paint being dragged. */}
      {ghost && (
        <span className="pointer-events-none fixed z-[2000] h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
          style={{ left: ghost.x, top: ghost.y, background: ghost.hex }} />
      )}
    </FloatPanel>
  )
}

