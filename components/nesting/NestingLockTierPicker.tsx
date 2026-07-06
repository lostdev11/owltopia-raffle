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

export function NestingLockTierPicker({
  tiers,
  selectedSlug,
  onSelect,
  className,
  required = false,
}: Props) {
  if (tiers.length === 0) return null

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-sm font-medium text-foreground">Choose lock period</p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Same {tiers[0]?.slug?.startsWith('gen2-') ? 'Gen 2' : 'Gen 1'} owl—pick 90 or 180 days before you confirm.
      </p>
      <div
        className="grid gap-2 sm:grid-cols-2"
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
                'flex min-h-[52px] w-full touch-manipulation flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-3 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-prime/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                selected
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-foreground'
                  : 'border-white/[0.08] bg-[#1c2620]/80 text-foreground hover:border-emerald-500/30 hover:bg-[#243328]'
              )}
              onClick={() => onSelect(tier.slug)}
            >
              <span className="text-base font-semibold">{tier.lock_period_days}-day lock</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {tier.reward_token ? `${tier.reward_token} · ` : ''}
                {formatRewardRate(Number(tier.reward_rate), tier.reward_rate_unit)}
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
