export default function Button({ variant = 'primary', className = '', ...props }) {
  const base = 'rounded-lg px-4 py-3 text-sm font-medium transition-colors'
  const variants = {
    primary: 'bg-ink text-paper hover:bg-black',
    outline: 'border border-ink/20 text-ink hover:bg-black/5',
    ghost: 'text-ink hover:bg-black/5',
    // Destructive actions (Delete sketch, etc.) -- same shape as every
    // other variant so it never needs a one-off hand-styled <button>.
    danger: 'bg-accent text-paper hover:bg-accent/90 disabled:opacity-60',
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}
