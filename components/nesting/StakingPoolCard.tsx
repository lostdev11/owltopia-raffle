import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import {
  formatDailyOwlPerNest,
  formatNestLockBalance,
  perchAssetKindLabel,
} from '@/lib/nesting/format'
import { nestingMutedActionButtonClass } from '@/lib/nesting/ui-classes'
import { cn } from '@/lib/utils'
import { PoolStatusBadge } from '@/components/nesting/PoolStatusBadge'
import { NestingPlatformFeeNotice } from '@/components/nesting/NestingPlatformFeeNotice'
import { NestingPerchLogoMark } from '@/components/nesting/NestingPerchLogoMark'

type Props = {
  pool: StakingPoolRow
  /** Landing page passes false when showing inactive admin preview — default true */
  compact?: boolean
  /** Kill switch: hide Start Nest CTAs, show a short pause note */
  nestingPaused?: boolean
}

export function StakingPoolCard({ pool, compact = false, nestingPaused = false }: Props) {
  const minMax =
    pool.minimum_stake != null || pool.maximum_stake != null
      ? `${pool.minimum_stake ?? '—'} → ${pool.maximum_stake ?? '—'}`
      : '—'
  const token = (pool.reward_token?.trim() || 'OWL').toUpperCase()
  const dailyLabel = formatDailyOwlPerNest(Number(pool.reward_rate), pool.reward_rate_unit, token)
  const balanceLabel =
    pool.lock_period_days > 0
      ? formatNestLockBalance(
          Number(pool.reward_rate),
          pool.reward_rate_unit,
          pool.lock_period_days,
          token
        )
      : null
  const lockLabel =
    pool.lock_period_days === 0 ? 'No lock' : `${pool.lock_period_days}-day lock`

  return (
    <Card className="flex flex-col rounded-xl border-border/70 bg-card/90 shadow-sm backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="font-display text-lg tracking-wide text-theme-prime">{pool.name}</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {pool.admin_only ? (
              <Badge className="bg-violet-600/90 hover:bg-violet-600 text-white border-0">Admin preview</Badge>
            ) : null}
            <PoolStatusBadge active={pool.is_active} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-snug line-clamp-2">{pool.description}</p>
      </CardHeader>
      <CardContent className="flex-1 space-y-2 text-sm">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:text-sm">
          <div>
            <dt className="text-muted-foreground">Nest type</dt>
            <dd className="font-medium">{perchAssetKindLabel(pool.asset_type)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Lock</dt>
            <dd className="font-medium">
              {pool.lock_period_days === 0 ? 'None' : `${pool.lock_period_days} days`}
            </dd>
          </div>
        </dl>

        <details className="group rounded-lg border border-border/60 bg-muted/15 open:bg-muted/20">
          <summary
            className={cn(
              'flex min-h-[44px] cursor-pointer touch-manipulation list-none items-center gap-2 px-3 py-2',
              'text-xs sm:text-sm [&::-webkit-details-marker]:hidden'
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground">Rates & details</span>
              <span className="mt-0.5 block truncate tabular-nums text-[11px] text-muted-foreground group-open:hidden">
                {dailyLabel}
                {balanceLabel ? ` · ${balanceLabel}` : ''}
              </span>
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="space-y-2 border-t border-border/50 px-3 pb-3 pt-2.5">
            <NestingPlatformFeeNotice className="text-xs text-muted-foreground leading-relaxed" stakeBundled />
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:text-sm">
              <div>
                <dt className="text-muted-foreground">Daily OWL</dt>
                <dd className="font-medium tabular-nums text-theme-prime">{dailyLabel}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Balance / nest</dt>
                <dd className="font-medium tabular-nums">{balanceLabel ?? 'No fixed lock total'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Amount range</dt>
                <dd className="font-mono text-xs">{minMax}</dd>
              </div>
              {pool.partner_project_slug ? (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Partner</dt>
                  <dd className="font-medium truncate">{pool.partner_project_slug}</dd>
                </div>
              ) : null}
            </dl>
            {balanceLabel ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Balance / nest is total {token} if you hold through unlock ({lockLabel}).
              </p>
            ) : null}
          </div>
        </details>
      </CardContent>
      {!compact && (
        <CardFooter className="flex items-end justify-between gap-3 border-t border-border/60 pt-4">
          <div className="flex min-w-0 flex-1 flex-wrap gap-2">
            {nestingPaused ? (
              <>
                <p className="text-sm text-muted-foreground leading-relaxed w-full">
                  New nests are paused—you can still claim OWL you already earned.
                </p>
                <Button asChild variant="default" size="sm" className="min-h-[44px] touch-manipulation font-semibold">
                  <Link href="/dashboard/nesting#nesting-claim-all-banner">Claim OWL</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className={cn(nestingMutedActionButtonClass)}>
                  <Link
                    href={`/dashboard/nesting?pool=${encodeURIComponent(pool.slug)}#nesting-your-nests`}
                    title="Manage nests you already opened"
                    aria-label="Manage Nest — view and manage nests you already opened"
                  >
                    Manage Nest
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="default" size="sm" className="min-h-[44px] touch-manipulation font-semibold">
                  <Link
                    href={`/dashboard/nesting?pool=${encodeURIComponent(pool.slug)}#nesting-open-nest-form`}
                    title="Start a new nest on this perch"
                    aria-label="Start Nest — open a new nest on this perch"
                  >
                    Start Nest
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className={cn(nestingMutedActionButtonClass)}>
                  <Link
                    href={`/dashboard/nesting?pool=${encodeURIComponent(pool.slug)}#nesting-your-nests`}
                    title="Manage nests you already opened"
                    aria-label="Manage Nest — view and manage nests you already opened"
                  >
                    Manage Nest
                  </Link>
                </Button>
              </>
            )}
          </div>
          <NestingPerchLogoMark className="mb-0.5" />
        </CardFooter>
      )}
    </Card>
  )
}
