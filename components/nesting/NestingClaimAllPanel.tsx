'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NestingActionStatusLine } from '@/components/nesting/NestingActionStatusLine'
import { nestingClaimAccruingButtonClass, nestingClaimReadyButtonClass } from '@/lib/nesting/ui-classes'
import { nestingTxPhaseLabel, type NestingTxPhase } from '@/lib/nesting/tx-states'
import { MIN_OWL_CLAIMABLE_TO_CLAIM } from '@/lib/staking/rewards'
import { cn } from '@/lib/utils'

type Props = {
  /** Active OWL nests on this wallet (show panel even when nothing claimable yet). */
  activeOwlNestCount: number
  claimableNestCount: number
  totalOwl: number
  busy: boolean
  disabled: boolean
  disabledReason: string | null
  phase: NestingTxPhase
  onClaimAll: () => void
  id?: string
  className?: string
}

export function NestingClaimAllPanel({
  activeOwlNestCount,
  claimableNestCount,
  totalOwl,
  busy,
  disabled,
  disabledReason,
  phase,
  onClaimAll,
  id = 'nesting-claim-all-banner',
  className,
}: Props) {
  if (activeOwlNestCount < 1) return null

  const canClaim = totalOwl >= MIN_OWL_CLAIMABLE_TO_CLAIM - 1e-9
  const claimDisabled = disabled || !canClaim || busy

  return (
    <div
      id={id}
      className={cn(
        'rounded-xl border-2 p-4 space-y-3 scroll-mt-24',
        canClaim
          ? 'border-theme-prime/55 bg-theme-prime/[0.1] shadow-[0_0_28px_rgba(0,255,136,0.12)]'
          : 'border-border/60 bg-muted/20',
        className
      )}
      role="region"
      aria-label="Claim all OWL rewards"
    >
      <p className="text-sm text-foreground leading-relaxed">
        {canClaim ? (
          claimableNestCount === 1 ? (
            <>
              <span className="font-semibold text-theme-prime">OWL is ready</span> on 1 nest — claim in one wallet
              payout.
            </>
          ) : (
            <>
              <span className="font-semibold text-theme-prime">{claimableNestCount} nests</span> have OWL ready — claim
              everything in one payout (no need to tap each nest).
            </>
          )
        ) : (
          <>
            <span className="font-medium text-muted-foreground">OWL is accruing</span> on{' '}
            {activeOwlNestCount === 1 ? 'your nest' : `${activeOwlNestCount} nests`}. Claim all unlocks when your nests
            total at least{' '}
            <span className="font-medium text-foreground">{MIN_OWL_CLAIMABLE_TO_CLAIM} OWL</span> combined (per-nest
            claim still needs {MIN_OWL_CLAIMABLE_TO_CLAIM} OWL on that nest).
          </>
        )}
      </p>
      {busy ? (
        <div
          className="flex items-center gap-3 rounded-lg border border-theme-prime/30 bg-background/60 px-3 py-2.5"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-theme-prime" aria-hidden />
          <p className="text-sm font-medium text-foreground">
            {nestingTxPhaseLabel(phase, 'claim') || 'Processing your claim…'}
          </p>
        </div>
      ) : null}
      <Button
        type="button"
        variant={canClaim ? 'default' : 'outline'}
        className={cn(
          'min-h-[52px] w-full touch-manipulation text-base',
          canClaim ? nestingClaimReadyButtonClass : nestingClaimAccruingButtonClass
        )}
        disabled={claimDisabled}
        onClick={onClaimAll}
        aria-disabled={claimDisabled}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
        {busy
          ? nestingTxPhaseLabel(phase, 'claim') || 'Processing…'
          : canClaim
            ? `Claim all · ${totalOwl.toLocaleString(undefined, { maximumFractionDigits: 6 })} OWL`
            : 'Claim all — accruing OWL'}
      </Button>
      {disabledReason && canClaim ? (
        <p className="text-xs text-amber-200/95 leading-relaxed text-center" role="status">
          {disabledReason}
        </p>
      ) : null}
      <NestingActionStatusLine phase={phase} labelContext="claim" className="min-h-[1.25rem] text-center" />
    </div>
  )
}
