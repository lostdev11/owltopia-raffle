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
      <div className="flex items-center gap-2 min-w-0 mb-3">
        <Users className="h-5 w-5 text-violet-400 shrink-0" aria-hidden />
        <h2 id="partner-raffles-carousel-heading" className="text-lg sm:text-xl font-bold truncate">
          Partner communities
        </h2>
      </div>
      <div
        className="flex items-stretch gap-5 overflow-x-auto pt-6 pb-10 snap-x snap-mandatory scroll-pl-5 scroll-pr-5 -mx-1 px-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: 'pan-x manipulation', WebkitOverflowScrolling: 'touch' as const }}
        aria-label="Featured partner raffles carousel"
      >
        {items.map(({ raffle, entries }, i) => (
          <div
            key={raffle.id}
            className="flex h-full min-h-0 w-[min(100%,26rem)] max-w-[min(100%,32rem)] shrink-0 snap-start min-w-0 sm:w-[25rem] md:w-[26rem]"
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
