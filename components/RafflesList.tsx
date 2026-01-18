'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { RaffleCard } from '@/components/RaffleCard'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import type { Raffle, Entry } from '@/lib/types'

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
  const [filteredRaffles, setFilteredRaffles] = useState(rafflesWithEntries)
  // Always use 'small' size as the only option
  const size: CardSize = 'small'
  
  // Use ref to track current raffles without causing re-renders
  const rafflesRef = useRef(rafflesWithEntries)
  const pendingRequestsRef = useRef<Set<string>>(new Set())
  const abortControllerRef = useRef<AbortController | null>(null)

  // Update filtered raffles when props change (e.g., after server refresh)
  useEffect(() => {
    setFilteredRaffles(rafflesWithEntries)
    rafflesRef.current = rafflesWithEntries
  }, [rafflesWithEntries])

  // Keep ref in sync with state changes (e.g., from handleRaffleDeleted or fetch updates)
  useEffect(() => {
    rafflesRef.current = filteredRaffles
  }, [filteredRaffles])

  // Function to fetch updated entries for all active raffles
  const fetchEntriesForActiveRaffles = useCallback(async () => {
    const now = new Date()
    
    // Get current raffles from ref (doesn't trigger re-renders)
    const currentRaffles = rafflesRef.current
    
    // Get all active raffles (those that are still active)
    const activeRaffles = currentRaffles.filter(({ raffle }) => {
      const endTime = new Date(raffle.end_time)
      return endTime > now && raffle.is_active
    })

    if (activeRaffles.length === 0) {
      return // No active raffles to poll
    }

    // Cancel any previous pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    // Create new AbortController for this batch of requests
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    // Filter out raffles that already have pending requests to prevent duplicates
    const rafflesToFetch = activeRaffles.filter(({ raffle }) => {
      if (pendingRequestsRef.current.has(raffle.id)) {
        return false
      }
      pendingRequestsRef.current.add(raffle.id)
      return true
    })

    if (rafflesToFetch.length === 0) {
      return // All raffles already have pending requests
    }

    try {
      // Fetch entries for all active raffles in parallel
      const results = await Promise.all(
        rafflesToFetch.map(async ({ raffle }) => {
          try {
            const response = await fetch(`/api/entries?raffleId=${raffle.id}&t=${Date.now()}`, {
              signal: abortController.signal
            })
            if (response.ok) {
              const entries = await response.json()
              return { raffleId: raffle.id, entries, raffle }
            }
            return null
          } catch (error: any) {
            // Don't log AbortError as it's expected when cancelling
            if (error.name !== 'AbortError') {
              console.error(`Error fetching entries for raffle ${raffle.id}:`, error)
            }
            return null
          } finally {
            // Remove from pending set when request completes
            pendingRequestsRef.current.delete(raffle.id)
          }
        })
      )

      // Filter out null results (failed fetches)
      const updates = results.filter((r): r is { raffleId: string; entries: Entry[]; raffle: Raffle } => r !== null)
      
      if (updates.length > 0 && !abortController.signal.aborted) {
        // Update state with all fetched entries at once
        setFilteredRaffles(current => {
          // Create a map for efficient lookup
          const updatedMap = new Map(current.map(r => [r.raffle.id, r]))
          
          // Apply all updates
          updates.forEach(({ raffleId, entries, raffle }) => {
            updatedMap.set(raffleId, { raffle, entries })
          })
          
          const updated = Array.from(updatedMap.values())
          // Update ref to match state
          rafflesRef.current = updated
          return updated
        })
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error fetching entries for active raffles:', error)
      }
    }
  }, [])

  // Poll for entry updates when there are active raffles
  // This ensures all users see updated ticket totals in real-time
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null
    let isMounted = true
    
    const checkAndPoll = () => {
      if (!isMounted) return
      
      const now = new Date()
      
      // Check if there are any active raffles using ref (doesn't trigger re-renders)
      const hasActiveRaffles = rafflesRef.current.some(({ raffle }) => {
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

    const startPolling = () => {
      // Clear any existing interval first
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }

      // Check if there are active raffles
      const now = new Date()
      const hasActiveRaffles = rafflesRef.current.some(({ raffle }) => {
        const endTime = new Date(raffle.end_time)
        return endTime > now && raffle.is_active
      })

      if (hasActiveRaffles) {
        // Initial check
        checkAndPoll()
        
        // Poll every 3 seconds to get fresh entry data (consistent with detail page)
        // Note: Real-time subscriptions would be more efficient but complex for multiple raffles
        pollInterval = setInterval(checkAndPoll, 3000)
      }
    }

    // Start polling
    startPolling()

    // Cleanup interval on unmount
    return () => {
      isMounted = false
      if (pollInterval) {
        clearInterval(pollInterval)
      }
      // Cancel any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      // Clear pending requests set
      pendingRequestsRef.current.clear()
    }
  }, [fetchEntriesForActiveRaffles, rafflesWithEntries])

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
    medium: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 lg:gap-8',
    large: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5 md:gap-6 lg:gap-10',
  }

  if (filteredRaffles.length === 0) {
    return null
  }

  return (
    <div>
      {title && (
        <h2 className="text-2xl font-bold mb-6">{title}</h2>
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
