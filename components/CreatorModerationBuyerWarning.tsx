import { AlertTriangle } from 'lucide-react'
import {
  CREATOR_MODERATION_BUYER_BADGE,
  CREATOR_MODERATION_BUYER_WARNING,
  raffleHasCreatorModerationBuyerFlag,
} from '@/lib/raffles/creator-moderation-policy'
import type { Raffle } from '@/lib/types'
import { Badge } from '@/components/ui/badge'

type Props = {
  raffle: Pick<Raffle, 'creator_restricted_listing'>
  variant?: 'banner' | 'badge' | 'both'
  className?: string
}

export function CreatorModerationBuyerWarning({
  raffle,
  variant = 'both',
  className = '',
}: Props) {
  if (!raffleHasCreatorModerationBuyerFlag(raffle)) return null

  return (
    <>
      {(variant === 'banner' || variant === 'both') && (
        <div
          role="alert"
          className={`flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100 ${className}`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <p>{CREATOR_MODERATION_BUYER_WARNING}</p>
        </div>
      )}
      {(variant === 'badge' || variant === 'both') && (
        <Badge
          variant="outline"
          className="border-amber-500/60 bg-amber-500/15 text-amber-900 dark:text-amber-100 shrink-0"
        >
          {CREATOR_MODERATION_BUYER_BADGE}
        </Badge>
      )}
    </>
  )
}
