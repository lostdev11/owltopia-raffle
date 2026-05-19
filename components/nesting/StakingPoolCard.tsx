import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { formatRewardRate, perchAssetKindLabel } from '@/lib/nesting/format'
import { nestingMutedActionButtonClass } from '@/lib/nesting/ui-classes'
import { cn } from '@/lib/utils'
import { PoolStatusBadge } from '@/components/nesting/PoolStatusBadge'

type Props = {
  pool: StakingPoolRow
  /** Landing page passes false when showing inactive admin preview — default true */
  compact?: boolean
  /** Kill switch: hide “Nest here” CTAs, show a short pause note */
  nestingPaused?: boolean
}

export function StakingPoolCard({ pool, compact = false, nestingPaused = false }: Props) {
  const minMax =
    pool.minimum_stake != null || pool.maximum_stake != null
      ? `${pool.minimum_stake ?? '—'} → ${pool.maximum_stake ?? '—'}`
      : '—'

  return (
    <Card className="flex flex-col rounded-xl border-border/70 bg-card/90 shadow-sm backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="font-display text-lg tracking-wide text-theme-prime">
            {pool.name}
          </CardTitle>
          <PoolStatusBadge active={pool.is_active} />
        </div>
        <p className="text-sm text-muted-foreground leading-snug">{pool.description}</p>
      </CardHeader>
      <CardContent className="flex-1 space-y-2 text-sm">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:text-sm">
          <div>
            <dt className="text-muted-foreground">Nest type</dt>
            <dd className="font-medium">{perchAssetKindLabel(pool.asset_type)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Lock</dt>
            <dd className="font-medium">{pool.lock_period_days === 0 ? 'None' : `${pool.lock_period_days} days`}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reward</dt>
            <dd className="font-medium tabular-nums">
              {pool.reward_token ? `${pool.reward_token} · ` : ''}
              {formatRewardRate(Number(pool.reward_rate), pool.reward_rate_unit)}
            </dd>
          </div>
          <div>
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
      </CardContent>
      {!compact && (
        <CardFooter className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
          {nestingPaused ? (
            <div className="flex flex-wrap gap-2 w-full">
              <p className="text-sm text-muted-foreground leading-relaxed w-full">
                New nests are paused—you can still claim OWL you already earned.
              </p>
              <Button asChild variant="default" size="sm" className="min-h-[44px] touch-manipulation font-semibold">
                <Link href="/dashboard/nesting#nesting-claim-all-banner">Claim OWL</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className={cn(nestingMutedActionButtonClass)}>
                <Link href="/dashboard/nesting">My nest</Link>
              </Button>
            </div>
          ) : (
            <>
              <Button asChild variant="outline" size="sm" className={cn(nestingMutedActionButtonClass)}>
                <Link href={`/dashboard/nesting?pool=${encodeURIComponent(pool.id)}`}>Nest here</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className={cn(nestingMutedActionButtonClass)}>
                <Link href={`/dashboard/nesting?pool=${encodeURIComponent(pool.id)}`}>My nest</Link>
              </Button>
            </>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
