import { useEffect, useMemo, useRef, useState } from 'react'
import Button from './Button'
import FloatPanel from './FloatPanel'
import Icon from './Icon'
import NewPaintForm from './NewPaintForm'
import PaletteBoard from './PaletteBoard'
import { STARTER_PALETTE, libraryPaints, opacityLabel, paintById, paintDescription, paintLabel, registerPaints } from '../../data/paints'
import { api } from '../../lib/api'
import { paintToWheel, wheelToHex } from '../../lib/colorWheel'
import {
  canMerge, defaultLayout, dropPaint, emptyPan, mergePan, nearestPaints, panAt,
  placePaint, placed, resize, splitPan, swapPaint, MAX_COLS, MAX_ROWS,
} from '../../lib/paletteLayout'
import { useSheetDrag } from '../../lib/useSheetDrag'
import { useWide } from '../../lib/useWide'

const DRAG_START = 5 // px before a press becomes a drag
const CARD_W = 320

/**
 * Edit palette (design doc, item 45). The paints on the Yurmby wheel, the
 * pans laid out like the tin, and the paints as pills under it
 * (PaletteBoard, shared with the Sketcher page).
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
  // A new sketcher picks how to start: the starter set, or nothing.
  const [choosing, setChoosing] = useState(!startPaints?.length)
  const [paints, setPaints] = useState(startPaints || [])
  const [layout, setLayout] = useState(() => startLayout || defaultLayout(startPaints || []))
  const [undo, setUndo] = useState(null) // { paints, layout, text }: the last removal, to take back
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
  const [cardPos, setCardPos] = useState(null) // { x, y, h } in the stage
  const cardRef = useRef(null)
  const [error, setError] = useState(null)
  const wide = useWide()
  useEffect(() => { if (form && wide) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [form?.mode, form?.id, wide]) // eslint-disable-line react-hooks/exhaustive-deps
  const stageRef = useRef(null)
  const wheelRef = useRef(null)
  const press = useRef(null)
  const [sheetOpen, setSheetOpen] = useState(true)
  const sheet = useSheetDrag(sheetOpen, setSheetOpen, '.pal-sheet-title')

  useEffect(() => { api.get('/api/paints').then(() => setLibTick((t) => t + 1)).catch(() => {}) }, [])

  const list = useMemo(() => paints.map(paintById).filter(Boolean), [paints, libTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const inPans = placed(layout)

  // A removal can be taken back for a few seconds.
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 8000)
    return () => clearTimeout(t)
  }, [undo])
  function removeWithUndo(nextPaints, nextLayout, text) {
    setUndo({ paints, layout, text })
    save(nextPaints, nextLayout)
  }

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
    // Beside the wheel, level with its top and no taller than it, so the
    // buttons stay in view; the list inside scrolls.
    const stage = stageRef.current?.getBoundingClientRect()
    const wheel = wheelRef.current?.getBoundingClientRect()
    if (stage && wheel) {
      setCardPos({ x: Math.min(wheel.right - stage.left + 12, stage.width - CARD_W), y: 0, h: Math.max(420, wheel.height) })
    }
  }
  const anchor = form ? (form.mode === 'edit' ? paintToWheel(paintById(form.id)?.hex || '#808080') : form.at) : null
  const candidates = useMemo(() => {
    if (!form) return []
    const q = query.trim().toLowerCase()
    return (anchor ? nearestPaints(anchor) : libraryPaints()).filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
  }, [form, anchor?.h, anchor?.c, query, libTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // A new paint joins the collection; dragging it onto a pan puts it in the tin.
  function addPaint(id = pending) {
    if (!id || paints.includes(id)) return
    save([...paints, id], layout)
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
    removeWithUndo(paints.filter((x) => x !== id), dropPaint(layout, id), `Removed ${paintLabel(paintById(id))} from your collection.`)
    setForm(null)
    setSel(null)
  }

  // ---- dragging a paint (from the wheel, a chip or a pan) ----
  // from: the pan it leaves; src: 'wheel' or 'pill' for a paint.
  function startPress(e, id, from = null, src = null) {
    e.preventDefault()
    press.current = { id, from, src, sx: e.clientX, sy: e.clientY, moved: false }
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
        // A new paint being typed keeps its form: the press only picks.
        const typing = form?.mode === 'new'
        if (p.from) { setSel(p.from); if (!typing) setForm(null) } else if (p.id && typing) {
          const home = layout.pans.find((x) => x.paint === p.id)
          setSel(home ? { r: home.r, c: home.c } : null)
        } else if (p.id) {
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
        // A pan dragged off the tin: its paint leaves the tin, not the collection.
        const pan = panAt(layout, p.from.r, p.from.c)
        if (pan?.paint) removeWithUndo(paints, emptyPan(layout, pan), `Took ${paintLabel(paintById(pan.paint))} out of your tin.`)
      } else if (p.src === 'wheel' && p.id) {
        // A circle dragged off the wheel: the paint leaves the collection.
        const r = wheelRef.current?.querySelector('svg')?.getBoundingClientRect()
        const off = !r || Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2)) > r.width / 2
        if (off) removePaint(p.id)
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
    const move = (ev) => setCardPos({ ...start.pos, x: start.pos.x + ev.clientX - start.x, y: start.pos.y + ev.clientY - start.y })
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
        <div className="pal-fields min-h-0 flex-1 overflow-y-auto">
          <NewPaintForm at={form.at} tapped={form.tapped} onSuggest={(at) => setForm((f) => (f?.mode === 'new' && !f.tapped ? { ...f, at } : f))} mine={paints} onUse={(id) => addPaint(id)} onSaved={addedNew} onCancel={() => setForm(null)} />
        </div>
      ) : (
      <div className="pal-fields flex min-h-0 flex-1 flex-col gap-2">
        <label className="flex items-center gap-2 rounded-lg border border-ink/20 px-3 py-2">
          <Icon name="search" size={14} className="text-ink/60" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search paint or pigment code" className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none" />
        </label>
        <ul className={`m-0 list-none overflow-y-auto p-0 ${wide ? 'min-h-[96px] flex-1' : 'max-h-[220px]'}`}>
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
                      {mine ? 'In your palette' : [p.added_by && !p.checked ? `Added by @${p.added_by}` : paintDescription(p.lean), opacityLabel(p.opacity)].filter(Boolean).join(' · ')}
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
      closeOnOutside={form?.mode !== 'new'}
      footer={
        <>
          {error && <span className="mr-auto text-sm text-accent">{error}</span>}
          {!error && undo && (
            <span className="mr-auto flex items-center gap-2 text-sm">
              {undo.text}
              <button type="button" className="font-semibold underline" onClick={() => { save(undo.paints, undo.layout); setUndo(null) }}>Undo</button>
            </span>
          )}
          <Button variant="action" onClick={() => onClose()}>Done</Button>
        </>
      }
    >

      {/* A new sketcher: start from the starter set, or from nothing. */}
      {choosing && paints.length === 0 && (
        <div className="flex flex-col gap-2 rounded-md bg-[var(--ed-field-bg)] p-3">
          <span className="text-sm font-semibold">How would you like to start?</span>
          <span className="text-sm text-ink/70">
            The starter set is {STARTER_PALETTE.length} paints: a warm and a cool of each primary, two earths, a white and a grey ({STARTER_PALETTE.map((id) => paintById(id)?.name).filter(Boolean).join(', ')}). Keep it, change it, or start from nothing.
          </span>
          <div className="flex flex-wrap gap-2">
            <Button variant="editorialSolid" size="sm" onClick={() => { save(STARTER_PALETTE, defaultLayout(STARTER_PALETTE)); setChoosing(false) }}>Use the starter set</Button>
            <Button variant="editorial" size="sm" onClick={() => setChoosing(false)}>Start with no paints</Button>
          </div>
        </div>
      )}

      {/* The wheel, the tin and the pills under it (PaletteBoard, as on the
          Sketcher page). Drag a circle, a pill or a pan; tap one to pick it. */}
      <PaletteBoard
        paints={list} layout={layout} focusId={focusId} selectedPan={sel}
        onPaintDown={(p, e, src) => startPress(e, p.id, null, src)}
        onPanDown={(p, e) => startPress(e, p.paint, { r: p.r, c: p.c })}
        wheel={{
          selected: form && form.mode !== 'edit' ? form.at : null,
          onTapWheel: (at) => (form?.mode === 'new' ? setForm({ ...form, at, tapped: true }) : openForm({ mode: 'add', at })),
        }}
        wheelNote={(
          <>
            <p className="m-0">Tap the wheel to add a paint from the library. Drag any paint off the wheel to remove it.</p>
            <p className="m-0 mt-1 text-ink/55">(Tip: Aim for a warm and cool of each primary!)</p>
          </>
        )}
        tinNote="Your field palette. Drag paints from the wheel into your pans to match your physical kit. Drag a pan out to remove it."
        editable placed={inPans} dropAt={dropAt} stageRef={stageRef} wheelRef={wheelRef}
        tinTop={(
          <>
            <div className="flex flex-wrap gap-4">
              {stepper('Rows', layout.rows, (n) => save(paints, resize(layout, n, layout.cols)), MAX_ROWS)}
              {stepper('Columns', layout.cols, (n) => save(paints, resize(layout, layout.rows, n)), MAX_COLS)}
            </div>
          </>
        )}
        pillsEnd={(
          <Button variant="editorial" size="sm" onClick={() => openForm({ mode: 'add', at: null })}>
            <Icon name="plus" size={14} /> Add paint
          </Button>
        )}
        tinBottom={pan ? (
          <div className="flex flex-col gap-2 border-t border-[var(--ed-row-rule)] pt-3">
            <span className="text-sm">
              <span className="font-semibold">{pan.w * pan.h > 1 ? 'Full pan' : 'Half pan'}</span>
              {panPaint ? ` · ${panPaint.code} ${paintLabel(panPaint)}` : ' · empty'}
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
              {panPaint && <Button variant="editorial" size="sm" onClick={() => removeWithUndo(paints, emptyPan(layout, panAt(layout, pan.r, pan.c)), `Took ${paintLabel(panPaint)} out of your tin.`)}>Take out of the tin</Button>}
              {panPaint && <Button variant="editorial" size="sm" onClick={() => removePaint(panPaint.id)}>Remove from my collection</Button>}
            </div>
            {pan.w * pan.h === 1 && !canMerge(layout, pan, 'right') && !canMerge(layout, pan, 'down') && (
              <span className="text-xs text-ink/55">A full pan takes the empty half pan to its right or below.</span>
            )}
          </div>
        ) : null}
        overlay={form && wide && cardPos && (
          // The form: a card beside the wheel (computer).
          <div ref={cardRef} className="absolute z-30 flex scroll-my-4 flex-col gap-2 rounded-lg bg-white p-3 shadow-[0_4px_24px_rgba(0,0,0,0.25)]"
            style={{ left: cardPos.x, top: cardPos.y, width: CARD_W, maxHeight: cardPos.h }}>
            {formBody}
          </div>
        )}
      />

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

