'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NestingActionStatusLine } from '@/components/nesting/NestingActionStatusLine'
import { nestingTxPhaseLabel, type NestingTxPhase } from '@/lib/nesting/tx-states'
import { cn } from '@/lib/utils'

type Props = {
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
  if (claimableNestCount < 1) return null

  return (
    <div
      id={id}
      className={cn(
        'rounded-xl border-2 border-theme-prime/55 bg-theme-prime/[0.1] p-4 space-y-3 scroll-mt-24 shadow-[0_0_28px_rgba(0,255,136,0.12)]',
        className
      )}
      role="region"
      aria-label="Claim all OWL rewards"
    >
      <p className="text-sm text-foreground leading-relaxed">
        {claimableNestCount === 1 ? (
          <>
            <span className="font-semibold text-theme-prime">OWL is ready</span> on 1 nest — claim in one wallet
            payout.
          </>
        ) : (
          <>
            <span className="font-semibold text-theme-prime">{claimableNestCount} nests</span> have OWL ready — claim
            everything in one payout (no need to tap each nest).
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
        variant="default"
        className="min-h-[52px] w-full touch-manipulation font-semibold text-base shadow-[0_0_22px_rgba(0,255,136,0.22)]"
        disabled={disabled}
        onClick={onClaimAll}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
        {busy
          ? nestingTxPhaseLabel(phase, 'claim') || 'Processing…'
          : `Claim all · ${totalOwl.toLocaleString(undefined, { maximumFractionDigits: 6 })} OWL`}
      </Button>
      {disabledReason ? (
        <p className="text-xs text-amber-200/95 leading-relaxed text-center" role="status">
          {disabledReason}
        </p>
      ) : null}
      <NestingActionStatusLine phase={phase} labelContext="claim" className="min-h-[1.25rem] text-center" />
    </div>
  )
}
