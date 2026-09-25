
export default function Button({ variant = 'primary', size = 'md', active = false, className = '', ...props }) {
  const isLink = variant === 'link' || variant === 'linkOnDark'
  const isPill = variant === 'pill' || variant === 'pillOnLight'

  const base = isLink
    ? 'transition-colors'
    : isPill
    ? 'rounded-full font-normal transition-all duration-150 active:scale-95 disabled:opacity-50'
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
  }

  const sizes = {
    md: 'px-2 py-2 text-sm',
    sm: 'px-3 py-1 text-xs',
  }

  const spacing = isLink ? '' : isPill ? 'px-3 py-1.5 text-2xs' : sizes[size]

  return <button className={`${base} ${spacing} ${variants[variant]} ${className}`} {...props} />
}
