import Icon from '../common/Icon'

/**
 * Capture's tools as a row of icon buttons (design doc, item 57): at the
 * top of the right panel, and at the top of the floating panel on a phone.
 * tools: [{ key, label, icon, disabled }]. A tool with no icon shows "…".
 */
export default function ToolRow({ tools, active, onPick }) {
  return (
    <div className="flex items-center justify-between gap-1 border-b border-sc-divider px-2 py-2" role="toolbar" aria-label="Tools">
      {tools.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onPick(t.key)}
          disabled={t.disabled}
          aria-label={t.label}
          aria-pressed={active === t.key}
          title={t.label}
          className={`flex h-11 min-w-11 flex-1 items-center justify-center rounded-[10px] transition-colors disabled:opacity-30 ${
            active === t.key ? 'bg-sc-border text-white' : 'text-sc-text2 hover:text-white'
          }`}
        >
          {t.icon ? <Icon name={t.icon} size={22} /> : <span className="text-xl font-bold leading-none">…</span>}
        </button>
      ))}
    </div>
  )
}
