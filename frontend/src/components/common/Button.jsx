import { Icon } from './Icon'

// Modal buttons from the design handoff (Create / Edit sketch): 44px tall,
// 10px radius, 15px bold. Colours are the sc-* tokens (index.css).
//   action           amber, the one primary action per screen
//   secondaryOnDark  outlined, next to an action
//   quietOnDark      text only (Skip)
//   choice           an answer to a guide question, full width, left aligned.
//                    onNext adds a round amber ">" inside it on the right,
//                    set up like the close buttons: a 44px tap area with a
//                    small circle inside (nextLabel names it). trailing puts
//                    another control there instead (the plan card's
//                    BookmarkButton). active: highlighted (blue border);
//                    selected: chosen to keep (blue fill, white text).
const MODAL_VARIANTS = ['action', 'secondaryOnDark', 'quietOnDark', 'choice']

export default function Button({ variant = 'primary', size = 'md', active = false, selected = false, className = '', onNext, nextLabel = 'Continue', trailing, ...props }) {
  const isLink = variant === 'link' || variant === 'linkOnDark'
  const isPill = variant === 'pill' || variant === 'pillOnLight'
  const isModal = MODAL_VARIANTS.includes(variant)

  const base = isLink
    ? 'transition-colors'
    : isPill
    ? 'rounded-full font-normal transition-all duration-150 active:scale-95 disabled:opacity-50'
    : isModal
    ? 'rounded-[10px] transition-colors disabled:opacity-50'
    : 'rounded-sm font-normal transition-colors'

  const variants = {
    primary: 'bg-ink text-paper hover:bg-black',
    primaryOnDark: 'bg-white text-ink hover:bg-white/90 disabled:opacity-60',
    outline: 'border border-ink/20 text-ink hover:bg-black/5',
    outlineOnDark: 'border border-white/30 text-white hover:bg-white/10',
    ghost: 'text-ink hover:bg-black/5',
    danger: 'bg-accent text-paper hover:bg-accent/90 disabled:opacity-60',
    link: 'text-sm text-ink/60 hover:text-ink',
    linkOnDark: 'text-sm text-white/70 hover:text-white',
    pill: active ? 'bg-white/60 text-ink' : 'bg-white/20 text-white/70 hover:bg-white/20',
    pillOnLight: active ? 'bg-ink text-white' : 'bg-ink/10 text-ink/70 hover:bg-ink/20',
    action: 'bg-sc-action px-5 font-bold text-sc-action-ink hover:brightness-105',
    secondaryOnDark: 'border-[1.5px] border-sc-strong px-[18px] font-bold text-white hover:bg-white/5',
    quietOnDark: 'px-3 font-semibold text-sc-text2 hover:text-white',
    // Height and padding: --space-option-* tokens (index.css), tighter on a phone.
    choice: `min-h-[var(--space-option-min-h)] w-full border-[1.5px] px-[var(--space-option-x)] py-[var(--space-option-y)] text-left font-semibold ${
      selected ? `bg-sc-guide text-white ${active ? 'border-white' : 'border-sc-guide'}`
        : active ? 'border-sc-guide bg-sc-raised text-white' : 'border-sc-border bg-sc-raised text-white hover:border-sc-strong'
    }`,
  }

  const sizes = {
    md: 'px-2 py-2 text-sm',
    sm: 'px-3 py-1 text-xs',
  }

  // Modal buttons: 44px tall, or 32px with size="sm" (the guide's Back and
  // Next, kept small so the question keeps the room).
  const modalSize = size === 'sm' && variant !== 'choice' ? 'min-h-8 text-sm' : 'min-h-11 text-md'
  const spacing = isLink ? '' : isPill ? 'px-3 py-1.5 text-2xs' : isModal ? `${modalSize} ${variant === 'choice' ? '' : 'whitespace-nowrap'}` : sizes[size]

  const button = (
    <button
      type={isModal ? 'button' : undefined}
      className={`${base} ${spacing} ${variants[variant]} ${variant === 'choice' && (onNext || trailing) ? 'pr-12' : ''} ${className}`}
      {...props}
    />
  )
  if (variant !== 'choice' || !(onNext || trailing)) return button
  return (
    <div className="relative w-full">
      {button}
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        {trailing || <NextButton onClick={onNext} label={nextLabel} />}
      </div>
    </div>
  )
}

// The bookmark inside a choice on the plan card (PlanReadCard.jsx): a tip
// or a focal area to keep. Same 44px tap area as NextButton. Without
// onToggle it only shows a kept item (locked after the final sketch).
export function BookmarkButton({ on, onToggle, label }) {
  if (!onToggle) {
    return on ? (
      <span className="flex h-11 w-11 items-center justify-center text-white" aria-label={label}>
        <Icon name="bookmark-filled" size={18} />
      </span>
    ) : null
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onToggle}
      className={`flex h-11 w-11 shrink-0 items-center justify-center ${on ? 'text-white' : 'text-sc-text3 hover:text-white'}`}
    >
      <Icon name={on ? 'bookmark-filled' : 'bookmark'} size={18} />
    </button>
  )
}

// The round amber ">" inside a picked choice, also used by the guide's
// own-words row (AIGuidance.jsx). Same set-up as the close buttons: a 44px
// tap area, only the mark inside shows.
export function NextButton({ onClick, label = 'Continue', className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`group flex h-11 w-11 shrink-0 items-center justify-center ${className}`}
    >
      <span className="flex h-7 w-7 animate-fade-in-scale items-center justify-center rounded-full bg-sc-action text-sc-action-ink group-hover:brightness-105">
        <Icon name="chevron-right" size={13} />
      </span>
    </button>
  )
}
