import { useEffect, useMemo, useState } from 'react'
import Button from './Button'
import FloatPanel from './FloatPanel'
import Icon from './Icon'
import { BRANDS, PAINTS, paintById } from '../../data/paints'

/**
 * Choose a paint (design handoff, PaintEditor). A popover under the row it
 * edits on a computer, a bottom sheet on a phone (FloatPanel "popover").
 *
 *   mode        'edit' ("Change paint", "Save changes") or 'new' ("Add a
 *               paint", "Add paint")
 *   paintId     the current paint (data/paints.js id)
 *   brand       the current brand; showBrand shows the brand list
 *   favs        the sketcher's favorite palette, as paint ids (the parent
 *               owns and saves it)
 *   top         px from the top of the nearest relative parent
 *   onSave(paintId, brand), onClose(), onToggleFav(paintId)
 *
 * Picking a paint only changes the pending choice. Nothing is saved until
 * Save.
 */
export default function PaintEditor({
  open,
  mode = 'edit',
  paintId,
  brand,
  showBrand = true,
  favs = [],
  top = 0,
  onSave,
  onClose,
  onToggleFav,
}) {
  const [pending, setPending] = useState(paintId || PAINTS[0].id)
  const [pendingBrand, setPendingBrand] = useState(brand || BRANDS[0])
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    setPending(paintId || favs[0] || PAINTS[0].id)
    setPendingBrand(brand || BRANDS[0])
    setQuery('')
  }, [open, paintId, brand]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = paintById(pending) || PAINTS[0]
  const q = query.trim().toLowerCase()
  const matches = (p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
  const favPaints = useMemo(() => favs.map(paintById).filter(Boolean).filter(matches), [favs, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const allPaints = PAINTS.filter(matches)
  const isFav = favs.includes(selected.id)

  const row = (p) => (
    <li key={p.id}>
      <button
        type="button"
        onClick={() => setPending(p.id)}
        aria-pressed={p.id === selected.id}
        className={`flex w-full items-center gap-3 px-4 py-2 text-left md:px-6 ${p.id === selected.id ? 'bg-[var(--ed-field-bg)]' : 'hover:bg-ink/5'}`}
      >
        <span className="swatch-chip !h-[30px] !w-[30px]" style={{ background: p.hex }} />
        <span className="w-[68px] shrink-0 text-xs font-bold">{p.code}</span>
        <span className="min-w-0 flex-1 truncate text-base">{p.name}</span>
        {p.id === selected.id && <Icon name="check" size={14} />}
      </button>
    </li>
  )

  return (
    <FloatPanel
      open={open}
      placement="popover"
      top={top}
      title={mode === 'new' ? 'Add a paint' : 'Change paint'}
      onClose={onClose}
      bodyClassName="!px-0 !py-0 !gap-0"
      footer={
        <div className="flex w-full flex-col gap-2">
          <Button
            variant="editorialSolid"
            size="sm"
            active={!isFav}
            className="w-full"
            aria-pressed={isFav}
            onClick={() => onToggleFav?.(selected.id)}
          >
            <Icon name={isFav ? 'star-filled' : 'star'} size={15} />
            {isFav ? 'In my favorite palette' : 'Add to my favorite palette'}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="editorial" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="editorialSolid" size="sm" onClick={() => onSave?.(selected.id, pendingBrand)}>
              {mode === 'new' ? 'Add paint' : 'Save changes'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5 px-4 pb-3 pt-4 md:px-6">
        <div className="flex items-center gap-3 bg-[var(--ed-field-bg)] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="ed-caption">Paint</div>
            <div className="truncate text-md font-semibold">{selected.code} · {selected.name}</div>
            <div className="text-xs text-ink/60">{selected.hex}</div>
          </div>
          <span className="h-11 w-11 shrink-0" style={{ background: selected.hex }} />
        </div>
        {showBrand && (
          <label className="flex flex-col gap-1 bg-[var(--ed-field-bg)] px-3 py-2.5">
            <span className="ed-caption">Brand</span>
            <select
              value={pendingBrand}
              onChange={(e) => setPendingBrand(e.target.value)}
              className="bg-transparent text-md font-semibold text-ink focus:outline-none"
            >
              {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2.5 bg-[var(--ed-field-bg)] px-3 py-2.5">
          <Icon name="search" size={15} className="text-ink/60" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search paint or pigment code"
            aria-label="Search paint or pigment code"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink/50 focus:outline-none"
          />
        </label>
      </div>
      <div className="min-h-0 overflow-y-auto border-t border-ink/10 pb-2 md:max-h-[240px]">
        {favPaints.length > 0 && (
          <>
            <div className="ed-caption px-4 pb-1 pt-3 md:px-6">My favorite palette</div>
            <ul>{favPaints.map(row)}</ul>
          </>
        )}
        <div className="ed-caption px-4 pb-1 pt-3 md:px-6">All paints</div>
        <ul>{allPaints.map(row)}</ul>
        {favPaints.length === 0 && allPaints.length === 0 && (
          <p className="px-4 py-3 text-sm text-ink/50 md:px-6">No paint matches "{query}".</p>
        )}
      </div>
    </FloatPanel>
  )
}
