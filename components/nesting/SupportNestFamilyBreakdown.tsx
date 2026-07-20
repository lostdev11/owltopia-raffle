'use client'

export type SupportNestFamilyRow = {
  family: string
  label: string
  wallet_mint_count: number
  active: number
  pending: number
}

function familyAccent(family: string): string {
  if (family === 'gen1-owl') return 'border-sky-500/35 bg-sky-500/10'
  if (family === 'gen2-owl') return 'border-emerald-500/35 bg-emerald-500/10'
  return 'border-border/60 bg-muted/30'
}

/**
 * Compact per-collection nest summary for admin support playbook / diagnostics.
 * Covers Owltopia coins, Gen 1 owls, and Gen 2 owls.
 */
export function SupportNestFamilyBreakdown({
  families,
  className = '',
}: {
  families: SupportNestFamilyRow[]
  className?: string
}) {
  if (!families.length) return null

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      <p className="text-xs font-medium text-muted-foreground">Nest families</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {families.map((f) => {
          const hasActivity = f.active > 0 || f.pending > 0 || f.wallet_mint_count > 0
          return (
            <div
              key={f.family}
              className={`rounded-lg border p-3 min-h-[44px] ${familyAccent(f.family)} ${
                hasActivity ? '' : 'opacity-60'
              }`}
            >
              <p className="text-sm font-medium text-foreground leading-tight">{f.label}</p>
              <dl className="mt-2 grid grid-cols-3 gap-1 text-center">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Active</dt>
                  <dd className="text-sm font-medium tabular-nums text-foreground">{f.active}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Pending</dt>
                  <dd className="text-sm font-medium tabular-nums text-foreground">{f.pending}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Wallet</dt>
                  <dd className="text-sm font-medium tabular-nums text-foreground">{f.wallet_mint_count}</dd>
                </div>
              </dl>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Scans owl-nest-365 (coins), gen1-owl-90d/180d, and gen2-owl-90d/180d. Gen rev-share SOL/USDC is separate from
        OWL claim catch-up.
      </p>
    </div>
  )
}
