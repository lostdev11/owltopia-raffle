'use client'

import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { formatRewardRate } from '@/lib/nesting/format'
import { cn } from '@/lib/utils'

type Props = {
  tiers: StakingPoolRow[]
  selectedSlug: string | null
  onSelect: (slug: string) => void
  className?: string
  /** Shown when confirm is blocked because no tier was picked yet. */
  required?: boolean
}

/** Segmented 90 / 180 day toggle (swap-style, one tap). */
export function NestingLockTierPicker({
  tiers,
  selectedSlug,
  onSelect,
  className,
  required = false,
}: Props) {
  if (tiers.length === 0) return null

  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.08] bg-black/25 p-1"
        role="radiogroup"
        aria-label="Lock period"
        aria-required={required}
      >
        {tiers.map((tier) => {
          const selected = selectedSlug === tier.slug
          return (
            <button
              key={tier.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={cn(
                'flex min-h-[52px] w-full touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 text-center transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-prime/50',
                selected
                  ? 'bg-emerald-500/15 text-foreground ring-1 ring-emerald-500/45'
                  : 'text-muted-foreground hover:bg-white/[0.05] hover:text-foreground'
              )}
              onClick={() => onSelect(tier.slug)}
            >
              <span className={cn('text-sm font-semibold', selected && 'text-theme-prime')}>
                {tier.lock_period_days} days
              </span>
              <span className="text-[11px] tabular-nums">
                {formatRewardRate(Number(tier.reward_rate), tier.reward_rate_unit)}
                {tier.reward_token ? ` ${tier.reward_token}` : ''}
              </span>
            </button>
          )
        })}
      </div>
      {required && !selectedSlug ? (
        <p className="text-xs text-amber-400/95 leading-relaxed" role="status">
          Pick 90 or 180 days to continue.
        </p>
      ) : null}
    </div>
  )
}
