import { useMemo, useState } from 'react'
import Button from './Button'
import { BRANDS, FAMILIES, colourFits, familyOf, libraryPaints, normalizeCode, paintLabel } from '../../data/paints'
import { api } from '../../lib/api'
import { wheelToHex } from '../../lib/colorWheel'

const TEMPS = [['warm', 'Warm'], ['cool', 'Cool'], ['', 'Neither']]

/**
 * A paint that is not in the library yet (design doc, item 46). Its colour
 * is the spot tapped on the wheel (tap again to move it). The checks, as
 * the sketcher types:
 *   1. each pigment code's form, and codes we don't know (the server asks
 *      to confirm those)
 *   2. the colour against the pigments' family ("PB pigments are blues")
 *   3. the brand from a list, and paints already in the library with the
 *      same brand and pigment or name, to pick instead
 * The new paint is labelled "Added by @username" until 3 other sketchers
 * carry it (item 46, check 5).
 *
 *   at { h, c }      the colour on the wheel
 *   mine [ids]       my palette
 *   onUse(id)        pick a paint already in the library
 *   onSaved(paint)   the new paint, added to the library and my palette
 *   onCancel()
 */
export default function NewPaintForm({ at, mine, onUse, onSaved, onCancel }) {
  const [brand, setBrand] = useState(BRANDS[0])
  const [otherBrand, setOtherBrand] = useState('')
  const [name, setName] = useState('')
  const [codesText, setCodesText] = useState('')
  const [temp, setTemp] = useState('')
  const [busy, setBusy] = useState(false)
  const [server, setServer] = useState(null) // { kind: 'unknown' | 'exists' | 'error', message, paint? }

  const brandName = (brand === 'Other' ? otherBrand : brand).trim()
  const raw = codesText.split(/[,+;/]+/).map((s) => s.trim()).filter(Boolean)
  const codes = raw.map(normalizeCode)
  const bad = raw.filter((_, i) => !codes[i])
  const good = [...new Set(codes.filter(Boolean))]
  const fits = colourFits(good, at)
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

  const ready = brandName && name.trim() && good.length && !bad.length && !busy

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
        lean: fam ? `${fam.word}${temp ? ` (${temp})` : ''}` : null,
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
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <select aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} className="field-select !py-2">
          {[...BRANDS, 'Other'].map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        {brand === 'Other'
          ? <input aria-label="Brand name" placeholder="Brand" maxLength={40} value={otherBrand} onChange={(e) => setOtherBrand(e.target.value)} className="field-input !py-2" />
          : <select aria-label="Warm or cool" value={temp} onChange={(e) => setTemp(e.target.value)} className="field-select !py-2">
              {TEMPS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
            </select>}
      </div>
      <input aria-label="Paint name" placeholder="Name on the tube, e.g. French Ultramarine" maxLength={60} value={name}
        onChange={(e) => setName(e.target.value)} className="field-input !py-2" />
      <input aria-label="Pigment codes" placeholder="Pigment code, e.g. PB29 (PB29 + PBk9 for a mix)" maxLength={60} value={codesText}
        onChange={(e) => setCodesText(e.target.value)} className="field-input !py-2" />
      {brand === 'Other' && (
        <select aria-label="Warm or cool" value={temp} onChange={(e) => setTemp(e.target.value)} className="field-select !py-2">
          {TEMPS.map(([v, l]) => <option key={l} value={v}>{l === 'Neither' ? 'Neither warm nor cool' : l}</option>)}
        </select>
      )}
      <p className="m-0 text-xs text-ink/55">Tap the wheel to set its colour. The pigment code is printed on the tube or the pan's wrapper.</p>

      {bad.length > 0 && <p className="m-0 text-xs text-accent">"{bad[0]}" is not a pigment code. It looks like PB29 or PY150.</p>}
      {!bad.length && good.length > 0 && !fits && (
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

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="editorial" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="editorialSolid" size="sm" disabled={!ready} onClick={() => save(false)}>Add to the library</Button>
      </div>
    </div>
  )
}
