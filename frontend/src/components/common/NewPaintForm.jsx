import { useEffect, useMemo, useState } from 'react'
import Button from './Button'
import { BRANDS, FAMILIES, OPACITY, colourFits, familyOf, libraryPaints, normalizeCode, paintLabel } from '../../data/paints'
import { api } from '../../lib/api'
import { paintToWheel, wheelToHex } from '../../lib/colorWheel'


// Where a family sits on the wheel, when no paint in the library shares
// the pigment: { h, c }.
const FAMILY_SPOT = {
  Y: { h: 55, c: 0.8 }, O: { h: 28, c: 0.8 }, R: { h: 355, c: 0.75 }, V: { h: 285, c: 0.6 },
  B: { h: 225, c: 0.7 }, G: { h: 150, c: 0.6 }, Br: { h: 25, c: 0.45 }, Bk: { h: 0, c: 0.04 }, W: { h: 0, c: 0 },
}

// A starting colour from the pigment: a library paint with the same
// pigments (PV19 -> Quinacridone Rose), else the family's place.
function suggestedSpot(codes) {
  if (!codes.length) return null
  const key = [...codes].sort().join('+')
  const same = libraryPaints().find((p) => [...(p.codes || [])].sort().join('+') === key)
    || libraryPaints().find((p) => (p.codes || []).length === 1 && p.codes[0] === codes[0])
  if (same) return paintToWheel(same.hex)
  return FAMILY_SPOT[familyOf(codes[0])] || null
}

/**
 * A paint that is not in the library yet (design doc, item 46). Its colour
 * starts from the pigment code (a library paint with the same pigment, or
 * the family's place on the wheel); a tap on the wheel sets it. The checks, as
 * the sketcher types:
 *   1. each pigment code's form, and codes we don't know (the server asks
 *      to confirm those)
 *   2. the colour against the pigments' family ("PB pigments are blues")
 *   3. the brand from a list, and paints already in the library with the
 *      same brand and pigment or name, to pick instead
 * The new paint is labelled "Added by @username" until 3 other sketchers
 * carry it (item 46, check 5).
 *
 *   at { h, c }      the colour on the wheel (null: none yet)
 *   tapped           the sketcher set it on the wheel
 *   onSuggest(at)    a starting colour from the pigment, until tapped
 *   mine [ids]       my palette
 *   onUse(id)        pick a paint already in the library
 *   onSaved(paint)   the new paint, added to the library and my palette
 *   onCancel()
 */
export default function NewPaintForm({ at, tapped, onSuggest, mine, onUse, onSaved, onCancel }) {
  const [brand, setBrand] = useState(BRANDS[0])
  const [otherBrand, setOtherBrand] = useState('')
  const [name, setName] = useState('')
  // Pigment codes as chips: type one, press Enter (or a comma) for the next.
  const [chips, setChips] = useState([])
  const [draft, setDraft] = useState('')
  const [draftBad, setDraftBad] = useState(null)
  const [opacity, setOpacity] = useState('')
  const [busy, setBusy] = useState(false)
  const [server, setServer] = useState(null) // { kind: 'unknown' | 'exists' | 'error', message, paint? }

  const brandName = (brand === 'Other' ? otherBrand : brand).trim()
  // The chips, and a code still being typed when it is already valid.
  const typed = normalizeCode(draft)
  const good = [...new Set([...chips, ...(typed ? [typed] : [])])].slice(0, 4)
  const bad = draftBad ? [draftBad] : []
  function commitDraft() {
    const parts = draft.split(/[,+;/]+/).map((x) => x.trim()).filter(Boolean)
    if (!parts.length) return
    const wrong = parts.find((x) => !normalizeCode(x))
    if (wrong) { setDraftBad(wrong); return }
    setChips((c) => [...new Set([...c, ...parts.map(normalizeCode)])].slice(0, 4))
    setDraft('')
    setDraftBad(null)
  }
  const fits = colourFits(good, at)

  // Until the sketcher taps the wheel, the colour follows the pigment code.
  const goodKey = good.join('+')
  useEffect(() => {
    if (tapped) return
    const spot = suggestedSpot(good)
    if (spot) onSuggest(spot)
  }, [goodKey, tapped]) // eslint-disable-line react-hooks/exhaustive-deps
  const fam = good.length ? FAMILIES[familyOf(good[0])] : null

  // Already in the library: the same brand and name, or the same brand and pigment.
  const similar = useMemo(() => {
    if (!brandName) return []
    const b = brandName.toLowerCase().replace(/\s+/g, '')
    const n = name.trim().toLowerCase()
    return libraryPaints().filter((p) => {
      if ((p.brand || '').toLowerCase().replace(/\s+/g, '') !== b) return false
      return (n && p.name.toLowerCase() === n) || (good.length && good.every((c) => (p.codes || []).includes(c)))
    }).slice(0, 4)
  }, [brandName, name, good.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = brandName && name.trim() && good.length && !bad.length && at && !busy

  async function save(confirmUnknown = false) {
    setBusy(true)
    setServer(null)
    try {
      const { h, c } = at
      const { data } = await api.post('/api/paints', {
        brand: brandName,
        name: name.trim(),
        pigment_codes: good,
        // Stored so the paint lands back on this spot (lib/colorWheel paintToWheel).
        hex: wheelToHex({ h, c: Math.min(1, c * 0.9) }),
        lean: fam ? fam.word : null,
        opacity: opacity || null,
        confirm_unknown: confirmUnknown,
      })
      onSaved(data)
    } catch (err) {
      const d = err?.response?.data?.detail
      if (d?.error === 'unknown_code') setServer({ kind: 'unknown', message: d.message })
      else if (d?.error === 'exists') setServer({ kind: 'exists', message: d.message, paint: d.paint })
      else setServer({ kind: 'error', message: d?.message || (typeof d === 'string' ? d : 'Could not save the paint. Try again.') })
    } finally {
      setBusy(false)
    }
  }

  const use = (p) => (
    <li key={p.id} className="flex items-center gap-2 text-xs">
      <span className="h-4 w-4 shrink-0 rounded-full border border-black/10" style={{ background: p.hex }} />
      <span className="min-w-0 flex-1 truncate">{paintLabel(p)} · {p.code}</span>
      {mine.includes(p.id)
        ? <span className="text-ink/50">In your palette</span>
        : <button type="button" className="font-semibold underline" onClick={() => onUse(p.id)}>Use this</button>}
    </li>
  )

  return (
    <div className="flex flex-col gap-2">
      <div className={`grid gap-2 ${brand === 'Other' ? 'grid-cols-[1fr_1fr]' : ''}`}>
        <select aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} className="field-select !py-2">
          {[...BRANDS, 'Other'].map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        {brand === 'Other' && (
          <input aria-label="Brand name" placeholder="Brand" maxLength={40} value={otherBrand} onChange={(e) => setOtherBrand(e.target.value)} className="field-input !py-2" />
        )}
      </div>
      <input aria-label="Paint name" placeholder="Name on the tube, e.g. French Ultramarine" maxLength={60} value={name}
        onChange={(e) => setName(e.target.value)} className="field-input !py-2" />
      {/* Pigments as chips: a mix such as Sap Green is PG7 + PY110. */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-ink/20 bg-white px-2 py-1.5 focus-within:border-ink/40">
        {chips.map((c) => (
          <span key={c} className="flex items-center gap-1 rounded-full bg-[var(--ed-field-bg)] py-0.5 pl-2 pr-1 text-xs font-bold">
            {c}
            <button type="button" aria-label={`Remove ${c}`} className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-ink/10"
              onClick={() => setChips((x) => x.filter((y) => y !== c))}>×</button>
          </span>
        ))}
        {chips.length < 4 && (
          <input aria-label="Pigment codes" maxLength={12} value={draft}
            placeholder={chips.length ? 'Another pigment' : 'Pigment code, e.g. PB29; Enter for the next'}
            onChange={(e) => { setDraft(e.target.value); setDraftBad(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitDraft() }
              else if (e.key === 'Backspace' && !draft && chips.length) setChips((x) => x.slice(0, -1))
            }}
            onBlur={commitDraft}
            className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-sm focus:outline-none" />
        )}
      </div>
      {good.length === 1 && !bad.length && (
        <span className="self-start rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Single pigment: mixes clean</span>
      )}
      {good.length > 1 && !bad.length && (
        <span className="has-tip has-tip-wrap self-start rounded-full bg-[var(--ed-field-bg)] px-2 py-0.5 text-[11px] font-semibold text-ink/75"
          data-tip="A mix with another mix puts 4 or 5 pigments on the page, which can turn to mud. The fewer the pigments, the cleaner the mix." tabIndex={0}>
          {good.length} pigments: convenience mix
        </span>
      )}
      <div className="flex items-center gap-2">
        <select aria-label="Opacity" value={opacity} onChange={(e) => setOpacity(e.target.value)} className="field-select min-w-0 flex-1 !py-2">
          <option value="">Opacity (on the tube)</option>
          {OPACITY.map((o) => <option key={o.value} value={o.value}>{o.mark} {o.label}</option>)}
        </select>
        <span className="has-tip has-tip-wrap has-tip-end flex h-7 w-7 shrink-0 cursor-help items-center justify-center rounded-full border border-ink/25 text-xs font-semibold text-ink/70"
          tabIndex={0} aria-label="About opacity"
          data-tip={`Opacity decides whether your pen lines and the paper glow through the wash, or the paint covers them. ${OPACITY.map((o) => `${o.mark} ${o.label}: ${o.note}.`).join(' ')}`}>i</span>
      </div>
      <p className="m-0 text-xs text-ink/55">
        {tapped
          ? 'Its colour is the spot you tapped. Tap again to move it.'
          : at ? 'Its colour starts from the pigment. Tap the wheel to match your paint.' : 'Enter the pigment code, or tap the wheel to set its colour.'}
        {' '}The pigment code is printed on the tube or the pan's wrapper.
      </p>

      {bad.length > 0 && <p className="m-0 text-xs text-accent">"{bad[0]}" is not a pigment code. It looks like PB29 or PY150.</p>}
      {tapped && !bad.length && good.length > 0 && !fits && (
        <p className="m-0 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          {good.map((c) => `P${familyOf(c)}`).filter((v, i, a) => a.indexOf(v) === i).join(', ')} pigments are {[...new Set(good.map((c) => FAMILIES[familyOf(c)].word))].join(' or ')}s. Is the colour right? Tap the wheel to move it.
        </p>
      )}
      {similar.length > 0 && (
        <div className="flex flex-col gap-1 rounded bg-[var(--ed-field-bg)] px-2 py-1.5">
          <span className="text-xs font-semibold">Already in the library</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">{similar.map(use)}</ul>
        </div>
      )}
      {server?.kind === 'exists' && server.paint && (
        <div className="flex flex-col gap-1 rounded bg-[var(--ed-field-bg)] px-2 py-1.5">
          <span className="text-xs">{server.message}</span>
          <ul className="m-0 list-none p-0">{use(server.paint)}</ul>
        </div>
      )}
      {server?.kind === 'unknown' && (
        <p className="m-0 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          {server.message} <button type="button" className="font-semibold underline" onClick={() => save(true)}>Save anyway</button>
        </p>
      )}
      {server?.kind === 'error' && <p className="m-0 text-xs text-accent">{server.message}</p>}

      <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 bg-white pt-1">
        <Button variant="editorial" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="editorialSolid" size="sm" disabled={!ready} onClick={() => save(false)}>Add to the library</Button>
      </div>
    </div>
  )
}
