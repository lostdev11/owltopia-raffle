'use client'

import { Loader2 } from 'lucide-react'
import {
  isNestingTxPhaseInFlight,
  type NestingTxPhase,
} from '@/lib/nesting/tx-states'
import { cn } from '@/lib/utils'

type Props = {
  phase: NestingTxPhase
  /** Extra detail under the active step (batch counts, fee included, etc.). */
  hint?: string | null
  nestCount?: number
  assetSingular?: string
  assetPlural?: string
  feeIncluded?: boolean
  className?: string
}

type StepId = 'preparing' | 'wallet' | 'confirming'

function activeStep(phase: NestingTxPhase): StepId | null {
  if (phase === 'preparing' || phase === 'submitting') return 'preparing'
  if (phase === 'awaiting_wallet_signature') return 'wallet'
  if (phase === 'syncing' || phase === 'confirming') return 'confirming'
  return null
}

/**
 * Friendly in-progress card for nest open — keeps non-tech holders oriented while
 * prepare → one wallet approval → server confirm runs.
 */
export function NestingStakeProgressCard({
  phase,
  hint,
  nestCount = 1,
  assetSingular = 'NFT',
  assetPlural = 'NFTs',
  feeIncluded = false,
  className,
}: Props) {
  if (!isNestingTxPhaseInFlight(phase) && phase !== 'failed') return null

  const step = activeStep(phase)
  const plural = nestCount > 1
  const assetWord = plural ? assetPlural : assetSingular
  const steps: Array<{ id: StepId; title: string; detail: string }> = [
    {
      id: 'preparing',
      title: plural ? `Setting up ${nestCount} nests` : 'Setting up your nest',
      detail: 'This part is automatic — no wallet popup yet.',
    },
    {
      id: 'wallet',
      title: 'Approve in your wallet',
      detail: feeIncluded
        ? `One approval locks your ${assetWord} and pays the small SOL fee together.`
        : `One approval locks your ${assetWord} in your wallet (it stays yours).`,
    },
    {
      id: 'confirming',
      title: 'Confirming on Owltopia',
      detail: 'Finishing up — stay on this page until you see success.',
    },
  ]

  return (
    <div
      className={cn(
        'rounded-xl border border-primary/35 bg-primary/[0.07] px-4 py-3.5 text-sm shadow-[0_0_28px_rgba(0,255,136,0.12)]',
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy={phase !== 'failed'}
    >
      <div className="flex items-start gap-3">
        {phase !== 'failed' ? (
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden />
        ) : null}
        <div className="min-w-0 flex-1 space-y-2.5">
          <div>
            <p className="font-semibold text-foreground leading-snug">
              {phase === 'failed' ? 'Nesting paused — try again' : 'Nesting in progress'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
              Keep this page open. On mobile, return here after your wallet closes.
            </p>
          </div>
          <ol className="space-y-2">
            {steps.map((s, idx) => {
              const isActive = step === s.id
              const stepOrder = step === 'preparing' ? 0 : step === 'wallet' ? 1 : step === 'confirming' ? 2 : -1
              const done = stepOrder > idx
              return (
                <li
                  key={s.id}
                  className={cn(
                    'rounded-lg px-2.5 py-2 leading-snug',
                    isActive && 'bg-background/55 ring-1 ring-primary/30',
                    done && 'opacity-70'
                  )}
                >
                  <p
                    className={cn(
                      'text-xs font-medium',
                      isActive ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {done ? '✓ ' : isActive ? '→ ' : `${idx + 1}. `}
                    {s.title}
                  </p>
                  {isActive ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{hint?.trim() || s.detail}</p>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </div>
  )
}
