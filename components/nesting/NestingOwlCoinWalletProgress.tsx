'use client'

import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type NestingWalletAssetLabels = {
  singular: string
  plural: string
}

export type NestingWalletLockTierOption = {
  slug: string
  lock_period_days: number
}

type Props = {
  /** Active nests + pending nests with freeze confirmed for this wallet/perch. */
  nestedCount: number
  /** Wallet-owned assets in the perch collection (nested + still available). Null until scan finishes. */
  totalCount: number | null
  /** Per-perch copy (Gen 1 owls, Gen 2 owls, Owltopia coins, …). */
  assetLabels: NestingWalletAssetLabels
  /** Count of wallet assets free to nest (not nested / blocked / opening). */
  notNestedCount?: number
  /** Dashboard: open picker / scroll. Landing: link to My nest. */
  nestCtaHref?: string
  onNestThese?: () => void
  /** Gen 1 / Gen 2: 90 / 180 day lock choices shown beside Nest these. */
  lockTiers?: NestingWalletLockTierOption[]
  selectedLockTierSlug?: string | null
  onSelectLockTier?: (slug: string) => void
  loading?: boolean
  className?: string
}

/** Per-wallet nest coverage for the active NFT perch (nested vs collection assets in wallet). */
export function NestingOwlCoinWalletProgress({
  nestedCount,
  totalCount,
  assetLabels,
  notNestedCount = 0,
  nestCtaHref = '/dashboard/nesting',
  onNestThese,
  lockTiers = [],
  selectedLockTierSlug = null,
  onSelectLockTier,
  loading = false,
  className,
}: Props) {
  const hasTotal = totalCount !== null && totalCount > 0
  const showLockTiers = lockTiers.length > 0 && Boolean(onSelectLockTier)
  const showNestCta = !loading && notNestedCount > 0
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

  const nestCtaLabel = (
    <span className="font-semibold text-theme-prime underline-offset-4 hover:underline">
      Nest these
    </span>
  )

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

      {showNestCta ? (
        <div className="rounded-lg border border-emerald-500/15 bg-black/20 px-3 py-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold tabular-nums text-foreground/90">{notNestedCount}</span>
            {' '}
            ready to nest — choose them in Open nest
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            {onNestThese ? (
              <button
                type="button"
                className="min-h-[44px] touch-manipulation text-xs"
                onClick={onNestThese}
              >
                {nestCtaLabel}
              </button>
            ) : (
              <Link
                href={nestCtaHref}
                className="inline-flex min-h-[44px] items-center touch-manipulation text-xs"
              >
                {nestCtaLabel}
              </Link>
            )}
            {showLockTiers ? (
              <div
                className="inline-flex rounded-lg border border-white/[0.08] bg-black/30 p-0.5"
                role="radiogroup"
                aria-label="Lock period"
              >
                {lockTiers.map((tier) => {
                  const selected = selectedLockTierSlug === tier.slug
                  return (
                    <button
                      key={tier.slug}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={cn(
                        'min-h-[44px] min-w-[52px] touch-manipulation rounded-md px-2.5 text-xs font-semibold tabular-nums transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-prime/50',
                        selected
                          ? 'bg-emerald-500/20 text-theme-prime ring-1 ring-emerald-500/40'
                          : 'text-muted-foreground hover:bg-white/[0.05] hover:text-foreground'
                      )}
                      onClick={() => onSelectLockTier?.(tier.slug)}
                    >
                      {tier.lock_period_days}d
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
