'use client'

import { useState } from 'react'
import { RafflesList } from '@/components/RafflesList'
import type { Raffle, Entry } from '@/lib/types'

type CardSize = 'small' | 'medium' | 'large'

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
  // Shared size state for Active and Past raffles
  const [sharedSize, setSharedSize] = useState<CardSize>('medium')

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-5xl md:text-6xl font-bold mb-2 bg-gradient-to-r from-white via-green-400 to-green-300 bg-clip-text text-transparent drop-shadow-lg tracking-tight">
          Owl Raffles
        </h1>
        <p className="text-lg font-medium tracking-wide bg-gradient-to-r from-gray-300 via-green-400 to-gray-300 bg-clip-text text-transparent">
          Trusted raffles with full transparency. Every entry verified on-chain.
        </p>
      </div>

      <div className="mb-12">
        <h2 className="text-2xl font-bold mb-6">Active Raffles</h2>
        {activeRafflesWithEntries.length > 0 ? (
          <RafflesList 
            rafflesWithEntries={activeRafflesWithEntries} 
            title={undefined}
            showViewSizeControls={true}
            size={sharedSize}
            onSizeChange={setSharedSize}
          />
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No active raffles at the moment. Check back soon!</p>
          </div>
        )}
      </div>

      <div className="mb-12">
        <h2 className="text-2xl font-bold mb-6">Future Raffles</h2>
        {futureRafflesWithEntries.length > 0 ? (
          <RafflesList 
            rafflesWithEntries={futureRafflesWithEntries} 
            title={undefined}
            showViewSizeControls={false}
          />
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No upcoming raffles scheduled at this time</p>
          </div>
        )}
      </div>

      {pastRafflesWithEntries.length > 0 && (
        <div className="mb-12">
          <RafflesList 
            rafflesWithEntries={pastRafflesWithEntries} 
            title="Past Raffles"
            showViewSizeControls={true}
            size={sharedSize}
            onSizeChange={setSharedSize}
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
