 'use client'
 
 import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
 import { RaffleCard } from '@/components/RaffleCard'
 import { WalletConnectButton } from '@/components/WalletConnectButton'
 import type { Raffle, Entry } from '@/lib/types'
 import type { RaffleProfitInfo } from '@/lib/raffle-profit'
import { getRaffleProfitInfo } from '@/lib/raffle-profit'
import { Flame } from 'lucide-react'
import Link from 'next/link'

type CardSize = 'small' | 'medium' | 'large'
type SortOption = 'days-left' | 'date' | 'ticket-price'
type SectionType = 'active' | 'future' | 'past'

interface RaffleWithEntriesItem {
  raffle: Raffle
  entries: Entry[]
  profitInfo?: RaffleProfitInfo
}

interface RafflesListProps {
  rafflesWithEntries: Array<RaffleWithEntriesItem>
  title?: string
  showViewSizeControls?: boolean
  size?: CardSize
  onSizeChange?: (size: CardSize) => void
  /** Section context: affects "days left" sort (past = most recent first) */
  section?: SectionType
  /** Optional callback when a raffle is deleted (for parent state management) */
  onRaffleDeleted?: (raffleId: string) => void
  /** Server time for consistent bucketing and relative strings (avoids wrong PC clock) */
  serverNow?: Date
  /** Optional callback with active raffles that are over the profit threshold */
  onTopProfitableChange?: (items: RaffleWithEntriesItem[]) => void
}

const MS_PER_DAY = 1000 * 60 * 60 * 24

// Calculate days left for sorting (same logic as display). Uses serverNow when provided for consistency.
function calculateDaysLeft(raffle: Raffle, now: Date): number {
  const startTime = new Date(raffle.start_time)
  const endTime = new Date(raffle.end_time)

  if (startTime > now) return Math.ceil((startTime.getTime() - now.getTime()) / MS_PER_DAY)
  if (endTime > now) return Math.ceil((endTime.getTime() - now.getTime()) / MS_PER_DAY)
  return Math.ceil((endTime.getTime() - now.getTime()) / MS_PER_DAY)
}

function getThresholdProgress(profitInfo?: RaffleProfitInfo): number | null {
  if (!profitInfo || profitInfo.threshold == null || !profitInfo.thresholdCurrency) {
    return null
  }
  const { revenue, threshold, thresholdCurrency } = profitInfo
  if (!threshold || threshold <= 0) return null
  let revenueInThreshold = 0
  if (thresholdCurrency === 'USDC') revenueInThreshold = revenue.usdc
  else if (thresholdCurrency === 'SOL') revenueInThreshold = revenue.sol
  else if (thresholdCurrency === 'OWL') revenueInThreshold = revenue.owl
  const progress = revenueInThreshold / threshold
  if (!Number.isFinite(progress) || progress < 0) return null
  return progress
}

export function RafflesList({
  rafflesWithEntries,
  title,
  showViewSizeControls = true,
  size: controlledSize,
  onSizeChange,
  section,
  onRaffleDeleted,
  serverNow,
  onTopProfitableChange,
}: RafflesListProps) {
  // Defensive: coerce null/undefined to [] so we never read properties on null
  const list = rafflesWithEntries ?? []
  const [filteredRaffles, setFilteredRaffles] = useState(list)
  const [sortBy, setSortBy] = useState<SortOption>('days-left')
  // Always use 'small' size as the only option
  const size: CardSize = 'small'

  // Use ref to track current raffles without causing re-renders
  const rafflesRef = useRef(list)
  const pendingRequestsRef = useRef<Set<string>>(new Set())
  const abortControllerRef = useRef<AbortController | null>(null)
  const [lastPurchaseNotice, setLastPurchaseNotice] = useState<{
    id: string
    title: string
    count: number
    at: number
  } | null>(null)

  const now = serverNow ?? new Date()
  const nowRef = useRef(now)
  nowRef.current = now

  // Sort raffles based on selected option. Use slice() + sort to avoid mutating.
  const sortedRaffles = useMemo(() => {
    const raffles = filteredRaffles.slice()

    switch (sortBy) {
      case 'days-left': {
        const mult = section === 'past' ? -1 : 1 // past: most recent first (desc)
        return raffles.sort((a, b) => {
          const daysLeftA = calculateDaysLeft(a.raffle, now)
          const daysLeftB = calculateDaysLeft(b.raffle, now)
          const cmp = mult * (daysLeftA - daysLeftB)
          if (cmp !== 0) return cmp
          // Tie-breaker: end_time, then start_time, then id
          const endA = new Date(a.raffle.end_time).getTime()
          const endB = new Date(b.raffle.end_time).getTime()
          if (endA !== endB) return endA - endB
          const startA = new Date(a.raffle.start_time).getTime()
          const startB = new Date(b.raffle.start_time).getTime()
          if (startA !== startB) return startA - startB
          return a.raffle.id.localeCompare(b.raffle.id)
        })
      }
      case 'date':
        return raffles.sort((a, b) => {
          const dateA = new Date(a.raffle.start_time).getTime()
          const dateB = new Date(b.raffle.start_time).getTime()
          return dateB - dateA
        })
      case 'ticket-price':
        return raffles.sort((a, b) => a.raffle.ticket_price - b.raffle.ticket_price)
      default:
        return raffles
    }
  }, [filteredRaffles, sortBy, section, now])

  // For the active raffles list, we no longer visually differentiate
  // \"Profit & Rev Share\" vs \"Heating Up\". All active raffles simply
  // render together in one list; grouping is only used for the top banner.
  const { profitableRaffles, heatingUpRaffles, otherRaffles } = useMemo(
    () => ({
      profitableRaffles: [] as RaffleWithEntriesItem[],
      heatingUpRaffles: [] as RaffleWithEntriesItem[],
      otherRaffles: sortedRaffles,
    }),
    [sortedRaffles]
  )

  // Notify parent when profitable raffles change for the active section (based on isProfitable flag)
  useEffect(() => {
    if (section === 'active' && typeof onTopProfitableChange === 'function') {
      const profitableByFlag = sortedRaffles.filter(
        (item) => item.profitInfo && item.profitInfo.isProfitable
      )
      onTopProfitableChange(profitableByFlag)
    }
  }, [section, onTopProfitableChange, sortedRaffles])

  // Update filtered raffles when props change (e.g., after server refresh)
  useEffect(() => {
    const next = rafflesWithEntries ?? []
    setFilteredRaffles(next)
    rafflesRef.current = next
  }, [rafflesWithEntries])

  // Keep ref in sync with state changes (e.g., from handleRaffleDeleted or fetch updates)
  useEffect(() => {
    rafflesRef.current = filteredRaffles
  }, [filteredRaffles])

  // Function to fetch updated entries for all active raffles (uses server time when available)
  const fetchEntriesForActiveRaffles = useCallback(async () => {
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

    // Use same-origin URL so fetch never fails due to wrong base (e.g. SSR or odd env)
    const apiBase = typeof window !== 'undefined' ? window.location.origin : ''

    try {
      // Fetch entries for all active raffles in parallel
      const results = await Promise.all(
        rafflesToFetch.map(async ({ raffle }) => {
          try {
            const url = `${apiBase}/api/entries?raffleId=${encodeURIComponent(raffle.id)}&t=${Date.now()}`
            const doFetch = () =>
              fetch(url, { signal: abortController.signal })
            // Retry once on "Failed to fetch" (e.g. dev server cold start / Turbopack)
            let response: Response
            try {
              response = await doFetch()
            } catch (err: any) {
              if (err?.name === 'AbortError') throw err
              const isNetworkFailure =
                err?.message === 'Failed to fetch' || err?.name === 'TypeError'
              if (isNetworkFailure) response = await doFetch()
              else throw err
            }
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
        const purchaseEvents: { id: string; title: string; count: number }[] = []
        setFilteredRaffles(current => {
          // Create a map for efficient lookup
          const updatedMap = new Map(current.map(r => [r.raffle.id, r]))
          
          // Apply all updates (recompute profit info from fresh entries)
          updates.forEach(({ raffleId, entries, raffle }) => {
            const existing = updatedMap.get(raffleId)
            const prevCount = existing?.entries?.length ?? 0
            const newCount = entries.length
            if (newCount > prevCount) {
              purchaseEvents.push({
                id: raffle.id,
                title: raffle.title,
                count: newCount - prevCount,
              })
            }
            const profitInfo = getRaffleProfitInfo(raffle, entries)
            updatedMap.set(raffleId, { raffle, entries, profitInfo })
          })
          
          const updated = Array.from(updatedMap.values())
          // Update ref to match state
          rafflesRef.current = updated
          return updated
        })
        if (purchaseEvents.length > 0 && section === 'active') {
          const latest = purchaseEvents[purchaseEvents.length - 1]
          setLastPurchaseNotice({
            id: latest.id,
            title: latest.title,
            count: latest.count,
            at: Date.now(),
          })
        }
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
      const currentNow = nowRef.current

      // Check if there are any active raffles using ref (doesn't trigger re-renders)
      const hasActiveRaffles = rafflesRef.current.some(({ raffle }) => {
        const endTime = new Date(raffle.end_time)
        return endTime > currentNow && raffle.is_active
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
    setFilteredRaffles(prev => prev.filter(({ raffle }) => raffle.id !== raffleId))
    // Also call parent callback if provided
    if (onRaffleDeleted) {
      onRaffleDeleted(raffleId)
    }
  }

  const gridClasses = {
    small: 'flex flex-col gap-2',
    medium: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 lg:gap-8',
    large: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5 md:gap-6 lg:gap-10',
  }

  // Auto-hide purchase notification after a short delay
  useEffect(() => {
    if (!lastPurchaseNotice) return
    const timeout = setTimeout(() => setLastPurchaseNotice(null), 5000)
    return () => clearTimeout(timeout)
  }, [lastPurchaseNotice])

  const anyRaffles = otherRaffles.length > 0

  if (!anyRaffles) {
    return null
  }

  return (
    <div className="w-full min-w-0">
      <div className="flex flex-wrap items-center justify-between mb-4 sm:mb-6 gap-4">
        {title && (
          <h2 className="text-xl sm:text-2xl font-bold">{title}</h2>
        )}
        {otherRaffles.length + heatingUpRaffles.length + profitableRaffles.length > 1 && (
          <div className="flex items-center gap-2 ml-auto">
            <label htmlFor="sort-select" className="text-sm text-muted-foreground whitespace-nowrap">
              Sort by:
            </label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
            >
              <option value="days-left">Days Left</option>
              <option value="date">Date</option>
              <option value="ticket-price">Ticket Price</option>
            </select>
          </div>
        )}
      </div>
      {section === 'active' && lastPurchaseNotice && (
        <div className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs sm:text-sm flex items-center gap-2">
          <span className="inline-flex items-center justify-center rounded-full bg-emerald-500/30 text-emerald-900 dark:text-emerald-50 h-5 w-5 text-[10px] font-bold">
            +
          </span>
          <span className="text-muted-foreground">
            Someone just bought{' '}
            <span className="font-semibold text-foreground">
              {lastPurchaseNotice.count > 1
                ? `${lastPurchaseNotice.count} tickets`
                : 'a ticket'}
            </span>{' '}
            in{' '}
            <span className="font-medium text-foreground">
              {lastPurchaseNotice.title}
            </span>
            .
          </span>
        </div>
      )}
      <div className={`w-full min-w-0 ${gridClasses[size]}`}>
        {otherRaffles.map(({ raffle, entries, profitInfo }, index) => (
          <RaffleCard
            key={raffle.id}
            raffle={raffle}
            entries={entries}
            size={size}
            section={section}
            profitInfo={profitInfo}
            onDeleted={handleRaffleDeleted}
            priority={index < 6}
            serverNow={serverNow}
          />
        ))}
      </div>
    </div>
  )
}
