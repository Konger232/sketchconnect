export default function Tag({ children }) {
  return (
    <span className="inline-block rounded-full bg-black/5 px-3 py-1 text-xs font-medium text-ink/80">
      {children}
    </span>
  )
}
