// The one shared <Button> used everywhere in the app -- Login, Edit
// Profile, Settings, sketch detail, and the capture wizard / AI-guided
// flow all render through this file, so a change here is a change
// everywhere UNLESS it's gated behind a prop like `size` below.
//
// `size` exists specifically so the wizard/AI flow (a compact,
// fixed-size modal and two-panel layout) can use a smaller button
// without touching every other page. `size="md"` (the default) is the
// button's original size, unchanged -- Login and everything else that
// doesn't pass `size` keeps looking exactly as it always has.
export default function Button({ variant = 'primary', size = 'md', className = '', ...props }) {
  const base = 'rounded-lg font-medium transition-colors'
  const variants = {
    primary: 'bg-ink text-paper hover:bg-black',
    outline: 'border border-ink/20 text-ink hover:bg-black/5',
    ghost: 'text-ink hover:bg-black/5',
    // Destructive actions (Delete sketch, etc.) -- same shape as every
    // other variant so it never needs a one-off hand-styled <button>.
    danger: 'bg-accent text-paper hover:bg-accent/90 disabled:opacity-60',
  }
  const sizes = {
    // Original size -- every call site outside the wizard/AI flow.
    md: 'px-4 py-3 text-sm',
    // Compact -- pass size="sm" at any call site inside the capture
    // wizard or the guided-prompt flow (FocalFrameEditor.jsx,
    // GuidedPromptFlow.jsx), where the default size reads as oversized
    // in that more compact, two-panel layout. Tune the values here to
    // retune every "sm" button at once.
    sm: 'px-3 py-2 text-xs',
  }
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />
}
