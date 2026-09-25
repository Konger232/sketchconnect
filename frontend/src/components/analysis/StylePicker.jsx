import Button from '../common/Button'
import LoadingDots from '../common/LoadingDots'
import { STYLES } from '../../data/styles'

export default function StylePicker({ style, analyzing, error, onSelectStyle }) {
  return (
    <div>
     {/* <div className="flex flex-col justify-center gap-4 bg-white p-5 text-ink md:p-6"> */}
      <div>
        <h1 className="text-base font-bold tracking-tight text-white">Pick a style</h1>
        <p className="mt-1 text-xs text-white/60">This shapes how the AI looks at your scene.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STYLES.map((s) => (
          <Button
            key={s.value}
            variant="pill"
            active={style === s.value}
            type="button"
            disabled={analyzing}
            onClick={() => onSelectStyle(s.value)}
            className="font-semibold"
          >
            {s.label}
          </Button>
        ))}
      </div>

      {analyzing && (
        <p className="animate-fade-in-up flex items-center text-sm text-white/60">
          Looking at your scene <LoadingDots className="ml-0.5" />
        </p>
      )}
      {error && <p className="text-sm text-accent">{error}</p>}
    </div>
  )
}