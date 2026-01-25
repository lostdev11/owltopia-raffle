'use client'

import { RafflesList } from '@/components/RafflesList'
import type { Raffle, Entry } from '@/lib/types'

interface RafflesPageClientProps {
  activeRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  futureRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  pastRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
}

export function RafflesPageClient({
  activeRafflesWithEntries,
  futureRafflesWithEntries,
  pastRafflesWithEntries,
}: RafflesPageClientProps) {

  return (
    <div className="container mx-auto py-4 sm:py-6 md:py-8 px-3 sm:px-4">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-2 bg-gradient-to-r from-white via-green-400 to-green-300 bg-clip-text text-transparent drop-shadow-lg tracking-tight">
          Owl Raffles
        </h1>
        <p className="text-base sm:text-lg font-medium tracking-wide bg-gradient-to-r from-gray-300 via-green-400 to-gray-300 bg-clip-text text-transparent">
          Trusted raffles with full transparency. Every entry verified on-chain.
        </p>
      </div>

      <div className="mb-8 sm:mb-12">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Active Raffles</h2>
        {activeRafflesWithEntries.length > 0 ? (
          <RafflesList
            rafflesWithEntries={activeRafflesWithEntries}
            title={undefined}
            section="active"
          />
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No active raffles at the moment. Check back soon!</p>
          </div>
        )}
      </div>

      <div className="mb-8 sm:mb-12">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Future Raffles</h2>
        {futureRafflesWithEntries.length > 0 ? (
          <RafflesList
            rafflesWithEntries={futureRafflesWithEntries}
            title={undefined}
            section="future"
          />
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No upcoming raffles scheduled at this time</p>
          </div>
        )}
      </div>

      {pastRafflesWithEntries.length > 0 && (
        <div className="mb-8 sm:mb-12">
          <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Past Raffles</h2>
          <RafflesList
            rafflesWithEntries={pastRafflesWithEntries}
            title={undefined}
            section="past"
          />
        </div>
      )}

      {activeRafflesWithEntries.length === 0 && 
       futureRafflesWithEntries.length === 0 && 
       pastRafflesWithEntries.length === 0 && (
        <div className="text-center py-16">
          <p className="text-xl text-muted-foreground mb-4">No raffles available</p>
        </div>
      )}
    </div>
  )
}
