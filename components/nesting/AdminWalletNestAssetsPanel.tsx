'use client'

import { useMemo, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { shortenAddress } from '@/lib/nesting/format'
import { supportNestFamilyLabel, type SupportNestFamilyKey } from '@/lib/nesting/support-nest-pools'
import type { NestingWalletAssetNestStatus, NestingWalletNestAsset } from '@/lib/nesting/admin-wallet-diagnostics'
import { cn } from '@/lib/utils'

type FilterChip = NestingWalletAssetNestStatus | 'all'

const FILTERS: { id: FilterChip; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'not_nested', label: 'Not nested' },
  { id: 'opening', label: 'Opening' },
  { id: 'nested', label: 'Nested' },
  { id: 'cross_wallet', label: 'Cross-wallet' },
]

function statusLabel(status: NestingWalletAssetNestStatus): string {
  if (status === 'not_nested') return 'Not nested'
  if (status === 'opening') return 'Opening'
  if (status === 'cross_wallet') return 'Cross-wallet'
  return 'Nested'
}

function statusTone(status: NestingWalletAssetNestStatus): string {
  if (status === 'not_nested') return 'text-theme-prime'
  if (status === 'opening') return 'text-sky-300/95'
  if (status === 'cross_wallet') return 'text-amber-200/95'
  return 'text-muted-foreground'
}

function CopyMintButton({ mint }: { mint: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-lg text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
      aria-label="Copy mint"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(mint)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        } catch {
          /* ignore */
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-theme-prime" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
    </button>
  )
}

/**
 * Admin diagnostics: per-mint nested / not-nested inventory for a holder wallet.
 */
export function AdminWalletNestAssetsPanel({
  assets,
  className,
}: {
  assets: NestingWalletNestAsset[]
  className?: string
}) {
  const [filter, setFilter] = useState<FilterChip>('all')

  const counts = useMemo(() => {
    const c: Record<NestingWalletAssetNestStatus, number> = {
      not_nested: 0,
      opening: 0,
      nested: 0,
      cross_wallet: 0,
    }
    for (const a of assets) c[a.nest_status] += 1
    return c
  }, [assets])

  const visible = useMemo(
    () => (filter === 'all' ? assets : assets.filter((a) => a.nest_status === filter)),
    [assets, filter]
  )

  if (assets.length === 0) return null

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-xs font-medium text-muted-foreground">
        Wallet nest assets ·{' '}
        <span className="tabular-nums text-foreground/85">
          {counts.not_nested} not nested · {counts.nested} nested
          {counts.opening > 0 ? ` · ${counts.opening} opening` : ''}
          {counts.cross_wallet > 0 ? ` · ${counts.cross_wallet} cross-wallet` : ''}
        </span>{' '}
        of {assets.length}
      </p>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter nest assets">
        {FILTERS.map((chip) => {
          const count = chip.id === 'all' ? assets.length : counts[chip.id]
          if (chip.id !== 'all' && count === 0) return null
          const active = filter === chip.id
          return (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                'min-h-[36px] touch-manipulation rounded-full px-3 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                active
                  ? 'bg-emerald-500/20 text-theme-prime ring-1 ring-emerald-500/40'
                  : 'bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]'
              )}
              onClick={() => setFilter(chip.id)}
            >
              {chip.label}
              <span className="ml-1 tabular-nums opacity-80">{count}</span>
            </button>
          )
        })}
      </div>
      <ul className="max-h-[min(50vh,22rem)] space-y-1 overflow-y-auto overscroll-contain rounded-lg border border-border/50 bg-black/20 p-1.5">
        {visible.length === 0 ? (
          <li className="px-3 py-4 text-center text-xs text-muted-foreground">No assets in this filter.</li>
        ) : (
          visible.map((row) => {
            const familyLabel =
              supportNestFamilyLabel(row.family as SupportNestFamilyKey) || row.family
            return (
              <li
                key={row.mint}
                className="flex min-h-[48px] items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-foreground/90">
                    {shortenAddress(row.mint, 6)}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {familyLabel}
                    {row.pool_slug ? ` · ${row.pool_slug}` : ''}
                    {row.cross_wallet?.wallet
                      ? ` · prior ${shortenAddress(row.cross_wallet.wallet, 4)}`
                      : ''}
                  </p>
                </div>
                <span className={cn('shrink-0 text-[11px] font-semibold', statusTone(row.nest_status))}>
                  {statusLabel(row.nest_status)}
                </span>
                <CopyMintButton mint={row.mint} />
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
