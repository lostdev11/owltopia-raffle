'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = {
  summaryLine: string
  feeLabel: string | null
  feeAvailable: boolean
  ctaLabel: string
  ctaDisabled: boolean
  busy?: boolean
  onViewFees: () => void
  onPrimary: () => void
  helperText?: string
  className?: string
}

export function OwlSwapTradeReviewBar({
  summaryLine,
  feeLabel,
  feeAvailable,
  ctaLabel,
  ctaDisabled,
  busy = false,
  onViewFees,
  onPrimary,
  helperText = 'Review both sides and the fees before signing.',
  className,
}: Props) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/10 bg-black/70 p-3 shadow-[0_0_40px_rgba(0,255,136,0.08)] backdrop-blur-md sm:p-4',
        className
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Trade summary</p>
          <p className="truncate font-display text-xl tracking-wide text-white sm:text-2xl">
            {summaryLine}
          </p>
          <p className="text-xs text-zinc-500">
            {feeAvailable && feeLabel ? (
              <>
                Owl fee (taker): <span className="text-theme-prime">{feeLabel}</span>
              </>
            ) : (
              <span className="text-amber-200">Fee unavailable</span>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onViewFees}
            className="min-h-[44px] touch-manipulation text-sm text-zinc-300 underline-offset-4 hover:text-theme-prime hover:underline sm:px-2"
          >
            View fees →
          </button>
          <Button
            type="button"
            disabled={ctaDisabled || busy}
            onClick={onPrimary}
            className="min-h-[48px] w-full touch-manipulation bg-theme-prime px-6 text-base font-semibold text-black hover:bg-theme-prime/90 sm:w-auto"
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…
              </>
            ) : (
              ctaLabel
            )}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-zinc-500">{helperText}</p>
    </div>
  )
}
