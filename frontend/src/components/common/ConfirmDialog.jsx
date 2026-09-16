import Button from './Button'

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Discard',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-ink">
        {title && <h2 className="text-base font-semibold">{title}</h2>}
        <p className="mt-2 text-sm text-ink/70">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}