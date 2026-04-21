import type { OwlVoteTotals } from '@/lib/db/owl-council'

export function ResultsBar({ totals }: { totals: OwlVoteTotals }) {
  const y = totals.yes
  const n = totals.no
  const a = totals.abstain
  const sum = y + n + a
  const pct = (v: number) => (sum <= 0 ? 0 : Math.round((v / sum) * 1000) / 10)

  return (
    <div className="space-y-3" aria-label="Vote results">
      <ResultRow label="Yes" value={y} pct={pct(y)} barClass="bg-emerald-500/80" />
      <ResultRow label="No" value={n} pct={pct(n)} barClass="bg-rose-500/70" />
      <ResultRow label="Abstain" value={a} pct={pct(a)} barClass="bg-muted-foreground/50" />
      <p className="text-xs text-muted-foreground tabular-nums">
        Total OWL-weight: {sum.toLocaleString(undefined, { maximumFractionDigits: 4 })}
      </p>
    </div>
  )
}

function ResultRow({
  label,
  value,
  pct,
  barClass,
}: {
  label: string
  value: number
  pct: number
  barClass: string
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {value} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
