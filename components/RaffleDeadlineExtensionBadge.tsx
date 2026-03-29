'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Props = {
  /** From raffle.time_extension_count — extensions after min tickets not met at end. */
  count?: number | null
  className?: string
  /** Tighter padding on dense card layouts */
  compact?: boolean
  /** Readable on dark gradient image overlay */
  onImageOverlay?: boolean
}

/**
 * Shows when the raffle deadline was extended because the ticket minimum was not met.
 * - 1 extension → "2nd round" (second sales period)
 * - 2 extensions → "Final round" (last period before refunds if still not met)
 */
export function RaffleDeadlineExtensionBadge({ count, className, compact, onImageOverlay }: Props) {
  const n = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  if (n < 1) return null

  const label = n >= 2 ? 'Final round' : '2nd round'
  const title =
    n >= 2
      ? 'Ticket minimum was not met at the end twice. This is the last extended period; if it is still not met, ticket refunds open and NFT prizes return to the host when applicable.'
      : 'Ticket minimum was not met when the raffle first ended, so the deadline was extended. You are in the second sales period for this raffle.'

  return (
    <Badge
      variant="outline"
      role="status"
      aria-label={title}
      title={title}
      className={cn(
        'shrink-0 font-medium tabular-nums touch-manipulation',
        onImageOverlay
          ? 'border-amber-300/70 bg-black/35 text-amber-100 hover:bg-black/45'
          : 'border-amber-500/55 bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/15',
        compact ? 'text-[9px] sm:text-[10px] px-1 py-0 min-h-[22px]' : 'text-[10px] sm:text-xs px-1.5 py-0.5 min-h-[24px]',
        className
      )}
    >
      {label}
    </Badge>
  )
}
