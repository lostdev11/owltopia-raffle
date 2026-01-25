'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { RafflesList } from '@/components/RafflesList'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import type { Raffle, Entry } from '@/lib/types'

interface AdminRafflesPageClientProps {
  activeRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  futureRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  pastRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
}

export function AdminRafflesPageClient({
  activeRafflesWithEntries,
  futureRafflesWithEntries,
  pastRafflesWithEntries,
}: AdminRafflesPageClientProps) {
  const router = useRouter()
  const [rafflesState, setRafflesState] = useState({
    active: activeRafflesWithEntries,
    future: futureRafflesWithEntries,
    past: pastRafflesWithEntries,
  })

  const handleRaffleDeleted = useCallback((raffleId: string) => {
    // Remove the deleted raffle from all categories
    setRafflesState(prev => ({
      active: prev.active.filter(({ raffle }) => raffle.id !== raffleId),
      future: prev.future.filter(({ raffle }) => raffle.id !== raffleId),
      past: prev.past.filter(({ raffle }) => raffle.id !== raffleId),
    }))
    
    // Refresh the page after a short delay to ensure database is updated
    setTimeout(() => {
      router.refresh()
    }, 500)
  }, [router])

  return (
    <div className="container mx-auto py-4 sm:py-6 md:py-8 px-3 sm:px-4">
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/admin">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-2">
          Admin - Manage Raffles
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground">
          View and manage all raffles, including past raffles. You can delete any raffle from here.
        </p>
      </div>

      <div className="mb-8 sm:mb-12">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Active Raffles</h2>
        {rafflesState.active.length > 0 ? (
          <RafflesList
            rafflesWithEntries={rafflesState.active}
            title={undefined}
            section="active"
            onRaffleDeleted={handleRaffleDeleted}
          />
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No active raffles at the moment.</p>
          </div>
        )}
      </div>

      <div className="mb-8 sm:mb-12">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Future Raffles</h2>
        {rafflesState.future.length > 0 ? (
          <RafflesList
            rafflesWithEntries={rafflesState.future}
            title={undefined}
            section="future"
            onRaffleDeleted={handleRaffleDeleted}
          />
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No upcoming raffles scheduled at this time</p>
          </div>
        )}
      </div>

      <div className="mb-8 sm:mb-12">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">
          Past Raffles ({rafflesState.past.length})
        </h2>
        {rafflesState.past.length > 0 ? (
          <RafflesList
            rafflesWithEntries={rafflesState.past}
            title={undefined}
            section="past"
            onRaffleDeleted={handleRaffleDeleted}
          />
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No past raffles found.</p>
          </div>
        )}
      </div>

      {rafflesState.active.length === 0 && 
       rafflesState.future.length === 0 && 
       rafflesState.past.length === 0 && (
        <div className="text-center py-16">
          <p className="text-xl text-muted-foreground mb-4">No raffles available</p>
        </div>
      )}
    </div>
  )
}
