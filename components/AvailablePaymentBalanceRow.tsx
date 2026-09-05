'use client'

import { CurrencyIcon } from '@/components/CurrencyIcon'
import type { RaffleCurrency } from '@/lib/types'
import { cn } from '@/lib/utils'

type AvailablePaymentBalanceRowProps = {
  currency: RaffleCurrency | string
  display: string
  /** When true, show amber insufficient hint under the row. */
  insufficient: boolean
  className?: string
  /** Match card compact sizing when needed. */
  compact?: boolean
}

/**
 * Secondary row under Total Cost: Available {currency} + amount + icon.
 */
export function AvailablePaymentBalanceRow({
  currency,
  display,
  insufficient,
  className,
  compact = false,
}: AvailablePaymentBalanceRowProps) {
  const code = String(currency || 'SOL').toUpperCase()

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'text-muted-foreground',
            compact ? 'text-xs' : 'text-sm'
          )}
        >
          Available {code}
        </span>
        <div
          className={cn(
            'font-medium flex items-center gap-2 text-muted-foreground',
            compact ? 'text-sm' : 'text-base'
          )}
        >
          {display} {code}
          <CurrencyIcon
            currency={code as 'SOL' | 'USDC' | 'OWL' | 'BAMBOO' | 'GOATS'}
            size={compact ? 14 : 16}
            className="inline-block"
          />
        </div>
      </div>
      {insufficient && (
        <p className={cn('text-amber-500/90', compact ? 'text-xs' : 'text-xs')}>
          Not enough {code} for this total
        </p>
      )}
    </div>
  )
}
