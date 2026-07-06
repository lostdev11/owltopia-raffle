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

import { formatRewardRate, perchAssetKindLabel } from '@/lib/nesting/format'

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

        <ul className="space-y-2 rounded-lg border border-border/60 bg-muted/15 p-3 text-xs sm:text-sm" role="list">

          {tiers.map((tier) => (

            <li key={tier.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">

              <span className="font-medium text-foreground">{tier.lock_period_days}-day nest</span>

              <span className="tabular-nums text-muted-foreground">

                {tier.reward_token ? `${tier.reward_token} · ` : ''}

                {formatRewardRate(Number(tier.reward_rate), tier.reward_rate_unit)}

              </span>

            </li>

          ))}

        </ul>

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

                  <Link href={dashboardHref}>My nest</Link>

                </Button>

              </>

            ) : (

              <>

                <Button asChild variant="outline" size="sm" className={cn(nestingMutedActionButtonClass)}>

                  <Link href={dashboardHref}>Nest here</Link>

                </Button>

                <Button asChild variant="outline" size="sm" className={cn(nestingMutedActionButtonClass)}>

                  <Link href={dashboardHref}>My nest</Link>

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


