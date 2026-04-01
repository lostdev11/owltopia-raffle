'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Entry } from '@/lib/types'
import { RealtimeChannel } from '@supabase/supabase-js'
import { RAFFLE_DETAIL_ENTRIES_REALTIME_SAFETY_POLL_MS } from '@/lib/dev-budget'

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
  const realtimeSafetyPollRef = useRef<NodeJS.Timeout | null>(null)
  const isRealtimeActiveRef = useRef(false) // Track subscription status synchronously
  /** Serializes fetches so a slow response cannot overwrite a newer one (avoids ticket count flicker). */
  const fetchGenRef = useRef(0)
  const fetchAbortRef = useRef<AbortController | null>(null)

  // Seed from SSR on first paint; ongoing truth comes from fetch + Realtime (see safety poll).
  useEffect(() => {
    if (initialEntries.length === 0) return
    setEntries((prev) => (prev.length === 0 ? initialEntries : prev))
  }, [initialEntries])

  // Fetch entries from API (absolute URL to avoid "Failed to fetch" with Turbopack/relative URLs).
  // Use AbortSignal + timeout so a stuck server or Supabase connection cannot hold the request for minutes.
  const ENTRY_FETCH_TIMEOUT_MS = 15_000

  const clearRealtimeSafetyPoll = useCallback(() => {
    if (realtimeSafetyPollRef.current) {
      clearInterval(realtimeSafetyPollRef.current)
      realtimeSafetyPollRef.current = null
    }
  }, [])

  const fetchEntries = useCallback(async () => {
    if (typeof window === 'undefined') return null
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller
    const gen = ++fetchGenRef.current

    const url = `${window.location.origin}/api/entries?raffleId=${encodeURIComponent(raffleId)}&_t=${Date.now()}`
    const timeoutId = setTimeout(() => controller.abort(), ENTRY_FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      })
      if (response.ok) {
        const updatedEntries = await response.json()
        if (gen !== fetchGenRef.current) return null
        setEntries(updatedEntries)
        onUpdate?.(updatedEntries)
        return updatedEntries
      }
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        console.error('Error fetching entries:', error)
      }
    } finally {
      clearTimeout(timeoutId)
      if (fetchAbortRef.current === controller) {
        fetchAbortRef.current = null
      }
    }
    return null
  }, [raffleId, onUpdate])

  // Set up realtime subscription
  useEffect(() => {
    if (!enabled || !raffleId) {
      // Cleanup when disabled
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      clearRealtimeSafetyPoll()
      isRealtimeActiveRef.current = false
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
              console.debug('Realtime update received:', payload.eventType)
              // When any entry changes, refetch all entries for this raffle
              // This ensures we have the complete, up-to-date list
              fetchEntries()
            }
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              console.debug('Realtime subscription active for raffle:', raffleId)
              isRealtimeActiveRef.current = true
              setIsUsingRealtime(true)
              clearRealtimeSafetyPoll()
              realtimeSafetyPollRef.current = setInterval(
                fetchEntries,
                RAFFLE_DETAIL_ENTRIES_REALTIME_SAFETY_POLL_MS
              )
              // Initial fetch
              fetchEntries().then(() => setIsLoading(false))
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
              console.debug('Realtime subscription closed, falling back to polling')
              isRealtimeActiveRef.current = false
              setIsUsingRealtime(false)
              clearRealtimeSafetyPoll()
              // Only fall back to polling if still enabled
              if (enabled && !pollIntervalRef.current) {
                pollIntervalRef.current = setInterval(fetchEntries, pollingInterval)
              }
              fetchEntries().then(() => setIsLoading(false))
            }
          })

        channelRef.current = channel

        // If subscription doesn't become active within 2 seconds, fall back to polling
        const fallbackTimeout = setTimeout(() => {
          // Only start polling if still enabled (raffle hasn't ended)
          if (!isRealtimeActiveRef.current && channelRef.current && enabled) {
            console.debug('Realtime subscription timeout, using polling fallback')
            supabase.removeChannel(channelRef.current)
            channelRef.current = null
            isRealtimeActiveRef.current = false
            setIsUsingRealtime(false)
            clearRealtimeSafetyPoll()
            if (!pollIntervalRef.current) {
              pollIntervalRef.current = setInterval(fetchEntries, pollingInterval)
            }
            fetchEntries().then(() => setIsLoading(false))
          }
        }, 2000)

        return () => {
          clearTimeout(fallbackTimeout)
          clearRealtimeSafetyPoll()
          fetchAbortRef.current?.abort()
          fetchGenRef.current += 1
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
            channelRef.current = null
          }
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
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
    // Only set up polling if still enabled (raffle hasn't ended)
    if ((!isSupabaseConfigured() || !isRealtimeActiveRef.current) && enabled) {
      // Only set up polling if we haven't already (realtime might have set it up)
      if (!pollIntervalRef.current && !isRealtimeActiveRef.current) {
        setIsLoading(true)
        fetchEntries().then(() => setIsLoading(false))
        pollIntervalRef.current = setInterval(fetchEntries, pollingInterval)
      }
    }

    // Cleanup function
    return () => {
      clearRealtimeSafetyPoll()
      fetchAbortRef.current?.abort()
      fetchGenRef.current += 1
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
  }, [enabled, raffleId, fetchEntries, pollingInterval, clearRealtimeSafetyPoll])

  return {
    entries,
    isLoading,
    isUsingRealtime,
    refetch: fetchEntries,
  }
}
