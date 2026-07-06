'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type NestingWalletAssetLabels = {
  singular: string
  plural: string
}

type Props = {
  /** Active nests + pending nests with freeze confirmed for this wallet/perch. */
  nestedCount: number
  /** Wallet-owned assets in the perch collection (nested + still available). Null until scan finishes. */
  totalCount: number | null
  /** Per-perch copy (Gen 1 owls, Gen 2 owls, Owltopia coins, …). */
  assetLabels: NestingWalletAssetLabels
  loading?: boolean
  className?: string
}

/** Per-wallet nest coverage for the active NFT perch (nested vs collection assets in wallet). */
export function NestingOwlCoinWalletProgress({
  nestedCount,
  totalCount,
  assetLabels,
  loading = false,
  className,
}: Props) {
  const hasTotal = totalCount !== null && totalCount > 0
  const pct =
    hasTotal && totalCount !== null
      ? Math.min(100, Math.round((nestedCount / totalCount) * 100))
      : null

  const label = loading
    ? `Loading ${assetLabels.plural} from your wallet…`
    : hasTotal
      ? `${nestedCount} of ${totalCount} ${totalCount === 1 ? assetLabels.singular : assetLabels.plural} nested`
      : nestedCount > 0
        ? `${nestedCount} ${nestedCount === 1 ? assetLabels.singular : assetLabels.plural} nested`
        : `Load your wallet to see how many ${assetLabels.plural} are nested`

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your wallet · {assetLabels.plural}
        </p>
        <p className="text-sm font-semibold tabular-nums text-foreground/90">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Scanning…
            </span>
          ) : hasTotal ? (
            <>
              <span className="text-theme-prime">{nestedCount}</span>
              <span className="text-muted-foreground"> / {totalCount}</span>
            </>
          ) : (
            <span className="text-theme-prime">{nestedCount}</span>
          )}
        </p>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted/50 ring-1 ring-emerald-500/15"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={hasTotal ? totalCount! : 100}
        aria-valuenow={hasTotal ? nestedCount : pct ?? 0}
        aria-label={label}
      >
        <div
          className={cn(
            'h-full rounded-full bg-gradient-to-r from-emerald-600/90 via-theme-prime to-emerald-400/90 transition-[width] duration-500 ease-out',
            loading && 'animate-pulse opacity-70'
          )}
          style={{ width: loading ? '35%' : `${pct ?? (nestedCount > 0 ? 100 : 0)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{label}</p>
    </div>
  )
}
