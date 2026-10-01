import { Icon } from './Icon'

// Modal buttons from the design handoff (Create / Edit sketch): 44px tall,
// 10px radius, 15px bold. Colours are the sc-* tokens (index.css).
//   action           amber, the one primary action per screen
//   secondaryOnDark  outlined, next to an action
//   quietOnDark      text only (Skip)
//   choice           an answer to a guide question, full width, left aligned.
//                    onNext adds a round amber ">" inside it on the right,
//                    set up like the close buttons: a 44px tap area with a
//                    small circle inside (nextLabel names it)
const MODAL_VARIANTS = ['action', 'secondaryOnDark', 'quietOnDark', 'choice']

export default function Button({ variant = 'primary', size = 'md', active = false, className = '', onNext, nextLabel = 'Continue', ...props }) {
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
    choice: `min-h-[50px] w-full border-[1.5px] px-3.5 py-2 text-left font-semibold ${
      active ? 'border-sc-guide bg-sc-raised text-white' : 'border-sc-border bg-sc-raised text-white hover:border-sc-strong'
    }`,
  }

  const sizes = {
    md: 'px-2 py-2 text-sm',
    sm: 'px-3 py-1 text-xs',
  }

  const spacing = isLink ? '' : isPill ? 'px-3 py-1.5 text-2xs' : isModal ? `min-h-11 text-md ${variant === 'choice' ? '' : 'whitespace-nowrap'}` : sizes[size]

  const button = (
    <button
      type={isModal ? 'button' : undefined}
      className={`${base} ${spacing} ${variants[variant]} ${variant === 'choice' && onNext ? 'pr-12' : ''} ${className}`}
      {...props}
    />
  )
  if (variant !== 'choice' || !onNext) return button
  return (
    <div className="relative w-full">
      {button}
      <button
        type="button"
        onClick={onNext}
        aria-label={nextLabel}
        // Same set-up as the close buttons: a 44px tap area, only the mark inside shows.
        className="group absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center"
      >
        <span className="flex h-7 w-7 animate-fade-in-scale items-center justify-center rounded-full bg-sc-action text-sc-action-ink group-hover:brightness-105">
          <Icon name="chevron-right" size={13} />
        </span>
      </button>
    </div>
  )
}
