'use client'

import Link from 'next/link'
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
      <div className="mb-3 min-w-0 sm:mb-4">
        <div className="mb-1 flex min-w-0 items-center gap-2">
          <Users className="h-5 w-5 shrink-0 text-violet-400" aria-hidden />
          <h2 id="partner-raffles-carousel-heading" className="truncate text-lg font-bold sm:text-xl">
            Owltopia Partner Program
          </h2>
        </div>
        <p className="text-sm text-muted-foreground sm:text-base">
          Featured partner raffles (2% platform fee on tickets) · swipe sideways on mobile ·{' '}
          <Link
            href="/partner-program"
            className="font-medium text-foreground/90 underline-offset-4 hover:underline touch-manipulation min-h-[44px] inline-flex items-center"
          >
            About the program
          </Link>
        </p>
      </div>
      <div
        className="flex items-stretch gap-4 overflow-x-auto pt-4 pb-8 snap-x snap-mandatory scroll-pl-3 scroll-pr-3 -mx-1 px-3 sm:gap-5 sm:pt-6 sm:pb-10 sm:scroll-pl-5 sm:scroll-pr-5 sm:px-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: 'pan-x manipulation', WebkitOverflowScrolling: 'touch' as const }}
        aria-label="Featured partner raffles carousel"
      >
        {items.map(({ raffle, entries }, i) => (
          <div
            key={raffle.id}
            className="flex min-h-0 w-[calc(100vw-1.5rem)] max-w-[26rem] shrink-0 snap-start self-stretch min-w-0 sm:w-[23rem] md:w-[25rem] lg:w-[26rem]"
          >
            {/* self-stretch + h-full chain: all slides match tallest row (avoid h-full on slide — breaks with auto-height scroller) */}
            <div className="flex h-full min-h-0 w-full flex-1 flex-col">
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
          </div>
        ))}
      </div>
    </section>
  )
}
