'use client'

import type { Raffle, Entry } from '@/lib/types'
import { RaffleCard } from '@/components/RaffleCard'
import { Users } from 'lucide-react'

type Item = { raffle: Raffle; entries: Entry[] }

/**
 * Horizontal snap carousel for featured active raffles from partner creators.
 * Native swipe on mobile (overflow-x + snap); touch-action per mobile-first rule.
 */
export function PartnerRafflesCarousel({
  items,
  serverNow,
}: {
  items: Item[]
  serverNow?: Date
}) {
  if (items.length === 0) return null

  return (
    <section
      className="w-full min-w-0 mb-6 sm:mb-8"
      aria-labelledby="partner-raffles-carousel-heading"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="h-5 w-5 text-violet-400 shrink-0" aria-hidden />
          <h2 id="partner-raffles-carousel-heading" className="text-lg sm:text-xl font-bold truncate">
            Partner communities
          </h2>
        </div>
        <p className="text-xs text-muted-foreground sm:text-right">
          Featured partner raffles · swipe sideways on mobile
        </p>
      </div>
      <div
        className="flex gap-4 overflow-x-auto pb-2 pt-0.5 snap-x snap-mandatory scroll-pl-2 -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: 'pan-x manipulation', WebkitOverflowScrolling: 'touch' as const }}
        aria-label="Featured partner raffles carousel"
      >
        {items.map(({ raffle, entries }, i) => (
          <div
            key={raffle.id}
            className="w-[min(100%,22rem)] max-w-[min(100%,24rem)] sm:w-[22rem] flex-none snap-center min-w-0"
          >
            <RaffleCard
              raffle={raffle}
              entries={entries}
              size="small"
              section="active"
              serverNow={serverNow}
              priority={i === 0}
              isPartnerCommunity
            />
          </div>
        ))}
      </div>
    </section>
  )
}
