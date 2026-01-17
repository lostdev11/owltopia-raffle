'use client'

import { useState, useEffect, useCallback } from 'react'
import { RaffleCard } from '@/components/RaffleCard'
import { Button } from '@/components/ui/button'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import type { Raffle, Entry } from '@/lib/types'
import { LayoutGrid, Grid3x3, Square } from 'lucide-react'

type CardSize = 'small' | 'medium' | 'large'

interface RafflesListProps {
  rafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  title?: string
  showViewSizeControls?: boolean
  size?: CardSize
  onSizeChange?: (size: CardSize) => void
}

export function RafflesList({ 
  rafflesWithEntries, 
  title,
  showViewSizeControls = true,
  size: controlledSize,
  onSizeChange
}: RafflesListProps) {
  const [internalSize, setInternalSize] = useState<CardSize>('medium')
  const [filteredRaffles, setFilteredRaffles] = useState(rafflesWithEntries)
  const size = controlledSize ?? internalSize
  const setSize = onSizeChange ?? setInternalSize

  // Update filtered raffles when props change (e.g., after server refresh)
  useEffect(() => {
    setFilteredRaffles(rafflesWithEntries)
  }, [rafflesWithEntries])

  // Function to fetch updated entries for all active raffles
  const fetchEntriesForActiveRaffles = useCallback(async () => {
    const now = new Date()
    
    // Get current raffles and identify active ones
    setFilteredRaffles(prev => {
      // Get all active raffles (those that are still active)
      const activeRaffles = prev.filter(({ raffle }) => {
        const endTime = new Date(raffle.end_time)
        return endTime > now && raffle.is_active
      })

      if (activeRaffles.length === 0) {
        return prev // No active raffles to poll
      }

      // Fetch entries for all active raffles in parallel
      Promise.all(
        activeRaffles.map(async ({ raffle }) => {
          try {
            const response = await fetch(`/api/entries?raffleId=${raffle.id}&t=${Date.now()}`)
            if (response.ok) {
              const entries = await response.json()
              return { raffleId: raffle.id, entries, raffle }
            }
            return null
          } catch (error) {
            console.error(`Error fetching entries for raffle ${raffle.id}:`, error)
            return null
          }
        })
      ).then(results => {
        // Filter out null results (failed fetches)
        const updates = results.filter((r): r is { raffleId: string; entries: Entry[]; raffle: Raffle } => r !== null)
        
        if (updates.length > 0) {
          // Update state with all fetched entries at once
          setFilteredRaffles(current => {
            // Create a map for efficient lookup
            const updatedMap = new Map(current.map(r => [r.raffle.id, r]))
            
            // Apply all updates
            updates.forEach(({ raffleId, entries, raffle }) => {
              updatedMap.set(raffleId, { raffle, entries })
            })
            
            return Array.from(updatedMap.values())
          })
        }
      }).catch(error => {
        console.error('Error fetching entries for active raffles:', error)
      })

      return prev // Return unchanged, will update via Promise callback
    })
  }, [])

  // Poll for entry updates when there are active raffles
  // This ensures all users see updated ticket totals in real-time
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null
    
    const checkAndPoll = () => {
      const now = new Date()
      
      // Check if there are any active raffles (reactive to time passing)
      const hasActiveRaffles = filteredRaffles.some(({ raffle }) => {
        const endTime = new Date(raffle.end_time)
        return endTime > now && raffle.is_active
      })

      // Stop polling if no active raffles
      if (!hasActiveRaffles) {
        if (pollInterval) {
          clearInterval(pollInterval)
          pollInterval = null
        }
        return
      }

      // Poll for active raffles
      fetchEntriesForActiveRaffles()
    }

    // Initial check
    checkAndPoll()

    // Only start interval if there are active raffles
    const now = new Date()
    const hasActiveRaffles = filteredRaffles.some(({ raffle }) => {
      const endTime = new Date(raffle.end_time)
      return endTime > now && raffle.is_active
    })

    if (hasActiveRaffles) {
      // Poll every 3 seconds to get fresh entry data (consistent with detail page)
      // Note: Real-time subscriptions would be more efficient but complex for multiple raffles
      pollInterval = setInterval(checkAndPoll, 3000)
    }

    // Cleanup interval on unmount or when no active raffles
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [filteredRaffles, fetchEntriesForActiveRaffles])

  // Callback to remove a raffle from the list (client-side immediate update)
  const handleRaffleDeleted = (raffleId: string) => {
    console.log('handleRaffleDeleted called, removing raffle:', raffleId)
    setFilteredRaffles(prev => {
      const filtered = prev.filter(({ raffle }) => raffle.id !== raffleId)
      console.log('Filtered raffles count:', filtered.length, 'from', prev.length)
      return filtered
    })
  }

  const gridClasses = {
    small: 'flex flex-col gap-3',
    medium: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6',
    large: 'grid grid-cols-1 lg:grid-cols-2 gap-8',
  }

  if (filteredRaffles.length === 0) {
    return null
  }

  return (
    <div>
      {title && (
        <h2 className="text-2xl font-bold mb-6">{title}</h2>
      )}
      {showViewSizeControls && (
        <div className="flex items-center justify-end gap-2 mb-6">
          <span className="text-sm text-muted-foreground mr-2">View size:</span>
          <div className="flex gap-1 border rounded-md p-1">
            <Button
              variant={size === 'small' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSize('small')}
              className="h-8 px-3"
              title="Small"
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={size === 'medium' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSize('medium')}
              className="h-8 px-3"
              title="Medium"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={size === 'large' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSize('large')}
              className="h-8 px-3"
              title="Large"
            >
              <Square className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <div className={gridClasses[size]}>
        {filteredRaffles.map(({ raffle, entries }, index) => (
          <RaffleCard 
            key={raffle.id} 
            raffle={raffle} 
            entries={entries} 
            size={size}
            onDeleted={handleRaffleDeleted}
            priority={index < 6} // Prioritize first 6 images (above the fold)
          />
        ))}
      </div>
    </div>
  )
}
