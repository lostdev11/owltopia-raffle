'use client'

import { Coins } from 'lucide-react'

import { SectionHeader } from '@/components/council/SectionHeader'
import { GenOwlRevShareClaimPanel } from '@/components/nesting/GenOwlRevShareClaimPanel'
import { GenOwlRevShareEstimatePanel } from '@/components/nesting/GenOwlRevShareEstimatePanel'
import { NestingClaimAllPanel } from '@/components/nesting/NestingClaimAllPanel'
import type { NestingTxPhase } from '@/lib/nesting/tx-states'
import { cn } from '@/lib/utils'

type Props = {
  connected: boolean
  needsSignIn: boolean
  activeOwlNestCount: number
  claimableNestCount: number
  totalOwl: number
  platformFeeLabel?: string | null
  claimAllBusy: boolean
  claimAllDisabled: boolean
  claimAllDisabledReason: string | null
  claimAllPhase: NestingTxPhase
  onClaimAllOwl: () => void
  className?: string
}

/**
 * Single Claims hub on Nesting:
 * - Monthly Gen1/Gen2 rev share (SOL/USDC) bundled with Claim all for that pool
 * - OWL nest rewards kept separate so users can leave OWL stacked
 */
export function NestingClaimsSection({
  connected,
  needsSignIn,
  activeOwlNestCount,
  claimableNestCount,
  totalOwl,
  platformFeeLabel,
  claimAllBusy,
  claimAllDisabled,
  claimAllDisabledReason,
  claimAllPhase,
  onClaimAllOwl,
  className,
}: Props) {
  return (
    <section id="nesting-claims" className={cn('scroll-mt-24 space-y-4', className)}>
      <SectionHeader
        title="Claims"
        description="Rev share and OWL are separate — claim either when you are ready; both stack until you do."
      />

      <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden />
          <h3 className="text-sm font-semibold text-foreground">Monthly rev share (SOL / USDC)</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Gen 1 and Gen 2 nest rev share for every open month — one tap claims the full stacked total
          (0.001 SOL fee per nest when fees are on).
        </p>
        <GenOwlRevShareEstimatePanel connected={connected} needsSignIn={needsSignIn} />
        <GenOwlRevShareClaimPanel connected={connected} needsSignIn={needsSignIn} />
      </div>

      <div className="space-y-3 rounded-xl border border-border/60 bg-muted/15 p-3 sm:p-4">
        <h3 className="text-sm font-semibold text-foreground">OWL nest rewards</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Optional and separate from rev share. Leave OWL stacked for raffles later, or claim when you want.
        </p>
        <NestingClaimAllPanel
          id="nesting-claim-all-banner"
          activeOwlNestCount={activeOwlNestCount}
          claimableNestCount={claimableNestCount}
          totalOwl={totalOwl}
          platformFeeLabel={platformFeeLabel}
          busy={claimAllBusy}
          disabled={claimAllDisabled}
          disabledReason={claimAllDisabledReason}
          phase={claimAllPhase}
          onClaimAll={onClaimAllOwl}
        />
        {activeOwlNestCount < 1 ? (
          <p className="text-xs text-muted-foreground">Open a nest to start accruing OWL.</p>
        ) : null}
      </div>
    </section>
  )
}
