'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type NestingEasyModeStepId = 'connect' | 'safeguards' | 'nest'

type Step = {
  id: NestingEasyModeStepId
  n: number
  title: string
  hint: string
}

const STEPS: Step[] = [
  { id: 'connect', n: 1, title: 'Connect', hint: 'Wallet + sign-in' },
  { id: 'safeguards', n: 2, title: 'Safeguards', hint: 'One short signature' },
  { id: 'nest', n: 3, title: 'Nest', hint: 'Pick owls → Confirm' },
]

type Props = {
  /** Furthest completed step (steps before this are done; this one is current). */
  current: NestingEasyModeStepId
  className?: string
  onSafeguardsClick?: () => void
}

function stepIndex(id: NestingEasyModeStepId): number {
  return STEPS.findIndex((s) => s.id === id)
}

/**
 * Compact 1–2–3 strip so first-time nesting feels like easy mode, not a scavenger hunt.
 */
export function NestingEasyModeSteps({ current, className, onSafeguardsClick }: Props) {
  const activeIdx = stepIndex(current)

  return (
    <nav
      className={cn(
        'rounded-xl border border-border/70 bg-muted/20 px-3 py-3 sm:px-4',
        className
      )}
      aria-label="Nesting steps"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5 px-0.5">
        Easy mode
      </p>
      <ol className="grid grid-cols-3 gap-2 sm:gap-3">
        {STEPS.map((step, idx) => {
          const done = idx < activeIdx
          const active = idx === activeIdx
          const interactive = step.id === 'safeguards' && active && onSafeguardsClick

          const inner = (
            <>
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                  done && 'bg-emerald-500/20 text-emerald-400',
                  active && 'bg-amber-500 text-amber-950',
                  !done && !active && 'bg-muted text-muted-foreground'
                )}
                aria-hidden
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step.n}
              </span>
              <span className="min-w-0 text-left">
                <span
                  className={cn(
                    'block text-xs font-semibold leading-tight',
                    active ? 'text-foreground' : done ? 'text-foreground/80' : 'text-muted-foreground'
                  )}
                >
                  {step.title}
                </span>
                <span className="block text-[10px] text-muted-foreground leading-snug mt-0.5">{step.hint}</span>
              </span>
            </>
          )

          return (
            <li key={step.id}>
              {interactive ? (
                <button
                  type="button"
                  onClick={onSafeguardsClick}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 touch-manipulation min-h-[44px]',
                    'ring-1 ring-amber-500/50 bg-amber-500/[0.08] hover:bg-amber-500/[0.14]'
                  )}
                  aria-current="step"
                >
                  {inner}
                </button>
              ) : (
                <div
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-1.5 py-1.5 min-h-[44px]',
                    active && 'ring-1 ring-primary/35 bg-primary/[0.06]'
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  {inner}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
