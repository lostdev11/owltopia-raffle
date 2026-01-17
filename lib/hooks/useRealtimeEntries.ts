'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Entry } from '@/lib/types'
import { RealtimeChannel } from '@supabase/supabase-js'

interface UseRealtimeEntriesOptions {
  raffleId: string
  enabled?: boolean
  onUpdate?: (entries: Entry[]) => void
  pollingInterval?: number // Fallback polling interval in ms (default: 3000)
  initialEntries?: Entry[] // Optional initial entries from server-side rendering
}

/**
 * Hook for subscribing to real-time entry updates for a raffle.
 * Falls back to polling if Supabase Realtime is not configured or unavailable.
 */
export function useRealtimeEntries({
  raffleId,
  enabled = true,
  onUpdate,
  pollingInterval = 3000,
  initialEntries = [],
}: UseRealtimeEntriesOptions) {
  const [entries, setEntries] = useState<Entry[]>(initialEntries)
  const [isLoading, setIsLoading] = useState(initialEntries.length === 0)
  const [isUsingRealtime, setIsUsingRealtime] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isRealtimeActiveRef = useRef(false) // Track subscription status synchronously

  // Fetch entries from API
  const fetchEntries = useCallback(async () => {
    try {
      const response = await fetch(`/api/entries?raffleId=${raffleId}&_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      })
      if (response.ok) {
        const updatedEntries = await response.json()
        setEntries(updatedEntries)
        onUpdate?.(updatedEntries)
        return updatedEntries
      }
    } catch (error) {
      console.error('Error fetching entries:', error)
    }
    return null
  }, [raffleId, onUpdate])

  // Set up realtime subscription
  useEffect(() => {
    if (!enabled || !raffleId) {
      return
    }

    // Check if Supabase is configured and try realtime first
    if (isSupabaseConfigured()) {
      try {
        // Clean up any existing channel
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current)
          channelRef.current = null
        }

        // Create a channel for realtime updates
        const channel = supabase
          .channel(`entries:raffle:${raffleId}`)
          .on(
            'postgres_changes',
            {
              event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
              schema: 'public',
              table: 'entries',
              filter: `raffle_id=eq.${raffleId}`,
            },
            (payload) => {
              console.log('Realtime update received:', payload.eventType)
              // When any entry changes, refetch all entries for this raffle
              // This ensures we have the complete, up-to-date list
              fetchEntries()
            }
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              console.log('Realtime subscription active for raffle:', raffleId)
              isRealtimeActiveRef.current = true
              setIsUsingRealtime(true)
              // Initial fetch
              fetchEntries().then(() => setIsLoading(false))
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
              console.warn('Realtime subscription closed, falling back to polling')
              isRealtimeActiveRef.current = false
              setIsUsingRealtime(false)
              // Fall back to polling
              if (!pollIntervalRef.current) {
                pollIntervalRef.current = setInterval(fetchEntries, pollingInterval)
              }
              fetchEntries().then(() => setIsLoading(false))
            }
          })

        channelRef.current = channel

        // If subscription doesn't become active within 2 seconds, fall back to polling
        const fallbackTimeout = setTimeout(() => {
          if (!isRealtimeActiveRef.current && channelRef.current) {
            console.warn('Realtime subscription timeout, using polling fallback')
            supabase.removeChannel(channelRef.current)
            channelRef.current = null
            isRealtimeActiveRef.current = false
            setIsUsingRealtime(false)
            if (!pollIntervalRef.current) {
              pollIntervalRef.current = setInterval(fetchEntries, pollingInterval)
            }
            fetchEntries().then(() => setIsLoading(false))
          }
        }, 2000)

        return () => {
          clearTimeout(fallbackTimeout)
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
            channelRef.current = null
          }
        }
      } catch (error) {
        console.error('Error setting up realtime subscription:', error)
        isRealtimeActiveRef.current = false
        setIsUsingRealtime(false)
      }
    }

    // If Supabase is not configured or realtime failed, use polling
    // Check ref instead of state to avoid dependency issues
    if (!isSupabaseConfigured() || !isRealtimeActiveRef.current) {
      // Only set up polling if we haven't already (realtime might have set it up)
      if (!pollIntervalRef.current && !isRealtimeActiveRef.current) {
        setIsLoading(true)
        fetchEntries().then(() => setIsLoading(false))
        pollIntervalRef.current = setInterval(fetchEntries, pollingInterval)
      }
    }

    // Cleanup function
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      isRealtimeActiveRef.current = false
    }
  }, [enabled, raffleId, fetchEntries, pollingInterval])

  return {
    entries,
    isLoading,
    isUsingRealtime,
    refetch: fetchEntries,
  }
}
