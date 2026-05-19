'use client'

import {
  nestingTxPhaseLabel,
  type NestingTxPhase,
  type NestingTxPhaseLabelContext,
} from '@/lib/nesting/tx-states'
import { cn } from '@/lib/utils'

type Props = {
  phase: NestingTxPhase
  className?: string
  labelContext?: NestingTxPhaseLabelContext
}

/** Muted one-line status for the current transaction step (keeps main layout intact). */
export function NestingActionStatusLine({ phase, className, labelContext = 'default' }: Props) {
  if (phase === 'idle') return null
  const text = nestingTxPhaseLabel(phase, labelContext)
  if (!text) return null
  return (
    <p className={cn('text-sm text-muted-foreground', className)} role="status" aria-live="polite">
      {text}
    </p>
  )
}
