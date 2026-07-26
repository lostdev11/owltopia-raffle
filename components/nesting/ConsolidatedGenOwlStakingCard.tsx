import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import {
  type GenOwlStakingGroupKey,
  genOwlGroupDashboardHref,
  genOwlStakingGroupDescription,
  genOwlStakingGroupLabel,
} from '@/lib/nesting/gen-owl-staking-groups'
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
import { GenOwlRevShareNotice } from '@/components/nesting/GenOwlRevShareNotice'

type Props = {
  groupKey: GenOwlStakingGroupKey
  tiers: StakingPoolRow[]
  compact?: boolean
  nestingPaused?: boolean
}

export function ConsolidatedGenOwlStakingCard({
  groupKey,
  tiers,
  compact = false,
  nestingPaused = false,
}: Props) {
  const label = genOwlStakingGroupLabel(groupKey)
  const adminPreview = tiers.some((t) => t.admin_only === true)
  const allActive = tiers.every((t) => t.is_active)
  const dashboardHref = genOwlGroupDashboardHref(groupKey)
  const sample = tiers[0]
  const rateTeaser = tiers
    .map((tier) => {
      const token = (tier.reward_token?.trim() || 'OWL').toUpperCase()
      return `${tier.lock_period_days}d ${formatDailyOwlPerNest(Number(tier.reward_rate), tier.reward_rate_unit, token)}`
    })
    .join(' · ')

  return (
    <Card className="flex flex-col rounded-xl border-border/70 bg-card/90 shadow-sm backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="font-display text-lg tracking-wide text-theme-prime">{label}</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {adminPreview ? (
              <Badge className="bg-violet-600/90 hover:bg-violet-600 text-white border-0">Admin preview</Badge>
            ) : null}
            <PoolStatusBadge active={allActive} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-snug line-clamp-2">
          {genOwlStakingGroupDescription(groupKey)}
        </p>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:text-sm">
          <div>
            <dt className="text-muted-foreground">Nest type</dt>
            <dd className="font-medium">{sample ? perchAssetKindLabel(sample.asset_type) : 'NFTs'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Lock options</dt>
            <dd className="font-medium">90 or 180 days</dd>
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
              <span className="block font-medium text-foreground">Rates & rev share</span>
              <span className="mt-0.5 block truncate tabular-nums text-[11px] text-muted-foreground group-open:hidden">
                {rateTeaser}
              </span>
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="space-y-3 border-t border-border/50 px-3 pb-3 pt-2.5">
            <NestingPlatformFeeNotice className="text-xs text-muted-foreground leading-relaxed" stakeBundled />
            <ul className="space-y-3 text-xs sm:text-sm" role="list">
              {tiers.map((tier) => {
                const token = (tier.reward_token?.trim() || 'OWL').toUpperCase()
                return (
                  <li key={tier.id} className="space-y-1.5" role="listitem">
                    <p className="font-medium text-foreground">{tier.lock_period_days}-day nest</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Daily OWL
                        </dt>
                        <dd className="tabular-nums text-theme-prime">
                          {formatDailyOwlPerNest(Number(tier.reward_rate), tier.reward_rate_unit, token)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Balance / nest
                        </dt>
                        <dd className="tabular-nums text-foreground/90">
                          {formatNestLockBalance(
                            Number(tier.reward_rate),
                            tier.reward_rate_unit,
                            tier.lock_period_days,
                            token
                          )}
                        </dd>
                      </div>
                    </dl>
                  </li>
                )
              })}
            </ul>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Balance / nest is total {sample?.reward_token?.trim() || 'OWL'} if you hold through unlock — one NFT =
              one nest.
            </p>
            <GenOwlRevShareNotice groupKey={groupKey} />
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
                    href={`${dashboardHref}#nesting-your-nests`}
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
                    href={`${dashboardHref}#nesting-open-nest-form`}
                    title="Start a new nest on this perch"
                    aria-label="Start Nest — open a new nest on this perch"
                  >
                    Start Nest
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className={cn(nestingMutedActionButtonClass)}>
                  <Link
                    href={`${dashboardHref}#nesting-your-nests`}
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
