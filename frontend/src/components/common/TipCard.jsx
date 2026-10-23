/**
 * The white card a tip sits in: the bag's pin cards (BagPhotos) and the
 * paint tips (PaintTip). A white card keeps the opacity squares reading
 * as on a tube: an empty square is transparent.
 */
export default function TipCard({ as: Tag = 'span', className = '', children, ...props }) {
  return (
    <Tag className={`flex flex-col gap-1 rounded-md bg-white px-3 py-2 text-left text-xs text-ink shadow-lg ${className}`} {...props}>
      {children}
    </Tag>
  )
}
