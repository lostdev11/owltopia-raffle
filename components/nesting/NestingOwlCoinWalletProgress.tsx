'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Loader2 } from 'lucide-react'
import { NestingStakedAssetThumb } from '@/components/nesting/NestingStakedAssetThumb'
import { shortenAddress } from '@/lib/nesting/format'
import { cn } from '@/lib/utils'

export type NestingWalletAssetLabels = {
  singular: string
  plural: string
}

export type NestingNotNestedAsset = {
  mint: string
  name: string | null
  image?: string | null
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
  /** Wallet assets that are free to nest (not nested / blocked / opening). */
  notNestedAssets?: NestingNotNestedAsset[]
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
  notNestedAssets = [],
  nestCtaHref = '/dashboard/nesting',
  onNestThese,
  lockTiers = [],
  selectedLockTierSlug = null,
  onSelectLockTier,
  loading = false,
  className,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const hasTotal = totalCount !== null && totalCount > 0
  const notNestedCount = notNestedAssets.length
  const showLockTiers = lockTiers.length > 0 && Boolean(onSelectLockTier)
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

  const nestCta = (
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

      {!loading && notNestedCount > 0 ? (
        <div className="rounded-lg border border-emerald-500/15 bg-black/20">
          <button
            type="button"
            className="flex min-h-[44px] w-full touch-manipulation items-center justify-between gap-2 px-3 py-2 text-left"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <span className="text-xs font-semibold text-foreground/90">
              Not nested yet · {notNestedCount}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-180'
              )}
              aria-hidden
            />
          </button>
          {expanded ? (
            <ul className="space-y-1 border-t border-white/[0.06] px-2 py-2" role="list">
              {notNestedAssets.map((row) => (
                <li
                  key={row.mint}
                  className="flex min-h-[44px] items-center gap-2.5 rounded-lg px-1.5 py-1"
                >
                  <NestingStakedAssetThumb
                    mint={row.mint}
                    hintImageUrl={row.image ?? null}
                    name={row.name ?? null}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {(row.name?.trim() && row.name.trim().slice(0, 72)) || assetLabels.singular}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {shortenAddress(row.mint, 5)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2">
            {onNestThese ? (
              <button
                type="button"
                className="min-h-[44px] touch-manipulation text-xs"
                onClick={onNestThese}
              >
                {nestCta}
              </button>
            ) : (
              <Link href={nestCtaHref} className="inline-flex min-h-[44px] items-center touch-manipulation text-xs">
                {nestCta}
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
