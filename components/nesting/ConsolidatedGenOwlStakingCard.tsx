import Link from 'next/link'
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
        <p className="text-sm text-muted-foreground leading-snug">{genOwlStakingGroupDescription(groupKey)}</p>
        <NestingPlatformFeeNotice className="text-xs text-muted-foreground leading-relaxed pt-1" stakeBundled />
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
        <div className="rounded-lg border border-border/60 bg-muted/15 p-3" role="list">
          <ul className="space-y-3 text-xs sm:text-sm">
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
          <p className="mt-2.5 text-[11px] leading-snug text-muted-foreground">
            Balance / nest is total {sample?.reward_token?.trim() || 'OWL'} if you hold through unlock — one NFT =
            one nest.
          </p>
        </div>
        <GenOwlRevShareNotice groupKey={groupKey} />
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
                    title="View and manage nests you already opened"
                    aria-label="My nest — view and manage nests you already opened"
                  >
                    My nest
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="default" size="sm" className="min-h-[44px] touch-manipulation font-semibold">
                  <Link
                    href={`${dashboardHref}#nesting-open-nest-form`}
                    title="Start a new nest on this perch"
                    aria-label="Nest here — start a new nest on this perch"
                  >
                    Nest here
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className={cn(nestingMutedActionButtonClass)}>
                  <Link
                    href={`${dashboardHref}#nesting-your-nests`}
                    title="View and manage nests you already opened"
                    aria-label="My nest — view and manage nests you already opened"
                  >
                    My nest
                  </Link>
                </Button>
                <p className="w-full text-[11px] leading-snug text-muted-foreground">
                  Nest here = start nesting · My nest = manage yours
                </p>
              </>
            )}
          </div>
          <NestingPerchLogoMark className="mb-0.5" />
        </CardFooter>
      )}
    </Card>
  )
}
