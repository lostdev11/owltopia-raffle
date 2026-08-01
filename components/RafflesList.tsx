 'use client'
 
 import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import { RaffleCard } from '@/components/RaffleCard'
import { RaffleScrollReveal } from '@/components/RaffleScrollReveal'
import { WalletConnectButton } from '@/components/WalletConnectButton'
 import type { Raffle, Entry } from '@/lib/types'
 import type { RaffleProfitInfo } from '@/lib/raffle-profit'
import {
  normalizeRaffleTicketCurrency,
  revenueInCurrency,
  shouldShowRevenueFlexPublic,
} from '@/lib/raffle-profit'
import { Flame } from 'lucide-react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { RAFFLES_LIST_ENTRIES_POLL_MS } from '@/lib/dev-budget'
import {
  PURCHASE_COMPLETED_EVENT,
  type PurchaseCompletedDetail,
} from '@/lib/cart/purchase-complete-events'
import { fetchEntrySummariesByRaffleIdsClient } from '@/lib/raffles/fetch-entry-summaries-client'
import {
  profitInfoFromEntryStats,
  stubEntriesFromListStats,
} from '@/lib/raffles/entry-list-stats'
import type { RaffleEntryListStats } from '@/lib/db/entry-summaries'
import { fetchMintNftMetadata } from '@/lib/client/nft-metadata-client'
import { isMobileDevice } from '@/lib/utils'

type CardSize = 'small' | 'medium' | 'large'
type SortOption = 'days-left' | 'date' | 'ticket-price'
type SectionType = 'active' | 'future' | 'past'

interface RaffleWithEntriesItem {
  raffle: Raffle
  entries: Entry[]
  profitInfo?: RaffleProfitInfo
  entryStats?: RaffleEntryListStats | null
}

interface RafflesListProps {
  rafflesWithEntries: Array<RaffleWithEntriesItem>
  title?: string
  /** Shown below the title/sort row (e.g. helper copy for a section). */
  titleDescription?: ReactNode
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
  /** When set, cards show partner badge for these creator wallets */
  partnerWalletSet?: Set<string>
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
  const thCur = normalizeRaffleTicketCurrency(thresholdCurrency)
  const revenueInThreshold = revenueInCurrency(revenue, thCur)
  const progress = revenueInThreshold / threshold
  if (!Number.isFinite(progress) || progress < 0) return null
  return progress
}

/**
 * `/raffles` server props always send `entries: []` (see `toRaffleWithEntries`); entries load via poll below.
 * Without this merge, `router.refresh()` replaces props and wipes fetched entries until the next poll → flicker.
 */
function mergeRafflesListProps(
  prev: RaffleWithEntriesItem[],
  next: RaffleWithEntriesItem[]
): RaffleWithEntriesItem[] {
  const prevById = new Map(prev.map((x) => [x.raffle.id, x]))
  return next.map((item) => {
    const prevItem = prevById.get(item.raffle.id)
    const nextEmpty = !item.entries?.length && !item.entryStats
    const prevHas = !!(prevItem?.entries?.length || prevItem?.entryStats)
    if (nextEmpty && prevHas && prevItem) {
      return {
        raffle: item.raffle,
        entries: prevItem.entries,
        profitInfo:
          prevItem.profitInfo ??
          (prevItem.entryStats
            ? profitInfoFromEntryStats(item.raffle, prevItem.entryStats)
            : undefined),
        entryStats: prevItem.entryStats ?? null,
      }
    }
    return item
  })
}

export function RafflesList({
  rafflesWithEntries,
  title,
  titleDescription,
  showViewSizeControls = true,
  size: controlledSize,
  onSizeChange,
  section,
  onRaffleDeleted,
  serverNow,
  onTopProfitableChange,
  partnerWalletSet,
}: RafflesListProps) {
  // Defensive: coerce null/undefined to [] so we never read properties on null
  const list = rafflesWithEntries ?? []
  const [filteredRaffles, setFilteredRaffles] = useState(list)
  const [sortBy, setSortBy] = useState<SortOption>('days-left')
  const [isMobile, setIsMobile] = useState(false)
  // Always use 'small' size as the only option
  const size: CardSize = 'small'
  const { publicKey } = useWallet()
  const viewerWallet = publicKey?.toBase58() ?? null
  const viewerWalletRef = useRef(viewerWallet)
  viewerWalletRef.current = viewerWallet

  useEffect(() => {
    setIsMobile(isMobileDevice())
  }, [])

  // Use ref to track current raffles without causing re-renders
  const rafflesRef = useRef(list)
  const abortControllerRef = useRef<AbortController | null>(null)
  const pollInFlightRef = useRef(false)
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

  // Parent effect runs before child RaffleCards — batch-warm mint metadata for NFT fallback thumbs.
  // On mobile, cap upfront prefetch so scroll stays responsive; off-screen cards load via viewport gate.
  useEffect(() => {
    const nftRaffles = sortedRaffles.filter(
      ({ raffle }) => raffle.prize_type === 'nft' && raffle.nft_mint_address?.trim()
    )
    const prefetchCap = isMobile ? 8 : nftRaffles.length
    for (const { raffle } of nftRaffles.slice(0, prefetchCap)) {
      void fetchMintNftMetadata(raffle.nft_mint_address!.trim(), true)
    }
  }, [sortedRaffles, isMobile])

  // Notify parent when “flex” raffles change: above listed floor when parseable, else composite threshold.
  useEffect(() => {
    if (section === 'active' && typeof onTopProfitableChange === 'function') {
      const profitableByFlag = sortedRaffles.filter(
        (item) => item.profitInfo && shouldShowRevenueFlexPublic(item.profitInfo)
      )
      onTopProfitableChange(profitableByFlag)
    }
  }, [section, onTopProfitableChange, sortedRaffles])

  // Update filtered raffles when props change (e.g., after server refresh)
  useEffect(() => {
    const next = rafflesWithEntries ?? []
    setFilteredRaffles((prev) => {
      const merged = mergeRafflesListProps(prev, next)
      rafflesRef.current = merged
      return merged
    })
  }, [rafflesWithEntries])

  // Keep ref in sync with state changes (e.g., from handleRaffleDeleted or fetch updates)
  useEffect(() => {
    rafflesRef.current = filteredRaffles
  }, [filteredRaffles])

  // One SQL-aggregate request for all active raffles (avoids N× full entry dumps → Disk IO).
  const fetchEntriesForActiveRaffles = useCallback(async () => {
    const currentRaffles = rafflesRef.current
    const activeRaffles = currentRaffles.filter(({ raffle }) => {
      const endTime = new Date(raffle.end_time)
      return endTime > nowRef.current && raffle.is_active
    })

    if (activeRaffles.length === 0 || pollInFlightRef.current) return

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    pollInFlightRef.current = true

    try {
      const ids = activeRaffles.map(({ raffle }) => raffle.id)
      let summaries = await fetchEntrySummariesByRaffleIdsClient(
        ids,
        viewerWalletRef.current,
        abortController.signal
      )
      // Retry once on empty map (cold start / transient) without hammering per-raffle endpoints
      if (summaries.size === 0 && !abortController.signal.aborted) {
        summaries = await fetchEntrySummariesByRaffleIdsClient(
          ids,
          viewerWalletRef.current,
          abortController.signal
        )
      }
      if (summaries.size === 0 || abortController.signal.aborted) return

      setFilteredRaffles((current) => {
        const updatedMap = new Map(current.map((r) => [r.raffle.id, r]))
        for (const { raffle } of activeRaffles) {
          const stats = summaries.get(raffle.id)
          if (!stats) continue
          const wallet = viewerWalletRef.current
          const entries = stubEntriesFromListStats(raffle.id, stats, wallet)
          const profitInfo = profitInfoFromEntryStats(raffle, stats)
          updatedMap.set(raffle.id, { raffle, entries, profitInfo, entryStats: stats })
        }
        const updated = Array.from(updatedMap.values())
        rafflesRef.current = updated
        return updated
      })
    } catch (error: unknown) {
      if ((error as Error)?.name !== 'AbortError') {
        console.error('Error fetching entry summaries for active raffles:', error)
      }
    } finally {
      pollInFlightRef.current = false
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
        
        // Poll for fresh entry data (detail page uses similar cadence; dev uses slower default — lib/dev-budget)
        pollInterval = setInterval(checkAndPoll, RAFFLES_LIST_ENTRIES_POLL_MS)
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
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      pollInFlightRef.current = false
    }
  }, [fetchEntriesForActiveRaffles, rafflesWithEntries])

  // After merged-cart checkout, refresh counts immediately on the grid (same tab).
  useEffect(() => {
    const onPurchase = (e: Event) => {
      const d = (e as CustomEvent<PurchaseCompletedDetail>).detail
      if (!d?.raffleIds?.length) return
      const idSet = new Set(d.raffleIds)
      const targets = rafflesRef.current.filter(({ raffle }) => idSet.has(raffle.id))
      if (targets.length === 0) return
      void (async () => {
        const summaries = await fetchEntrySummariesByRaffleIdsClient(
          targets.map((t) => t.raffle.id),
          viewerWalletRef.current
        )
        if (summaries.size === 0) return
        setFilteredRaffles((current) => {
          const updatedMap = new Map(current.map((r) => [r.raffle.id, r]))
          for (const { raffle } of targets) {
            const stats = summaries.get(raffle.id)
            if (!stats) continue
            const wallet = viewerWalletRef.current
            const entries = stubEntriesFromListStats(raffle.id, stats, wallet)
            const profitInfo = profitInfoFromEntryStats(raffle, stats)
            updatedMap.set(raffle.id, { raffle, entries, profitInfo, entryStats: stats })
          }
          const updated = Array.from(updatedMap.values())
          rafflesRef.current = updated
          return updated
        })
      })()
    }
    window.addEventListener(PURCHASE_COMPLETED_EVENT, onPurchase)
    return () => window.removeEventListener(PURCHASE_COMPLETED_EVENT, onPurchase)
  }, [])

  // Callback to remove a raffle from the list (client-side immediate update)
  const handleRaffleDeleted = (raffleId: string) => {
    setFilteredRaffles(prev => prev.filter(({ raffle }) => raffle.id !== raffleId))
    // Also call parent callback if provided
    if (onRaffleDeleted) {
      onRaffleDeleted(raffleId)
    }
  }

  const gridClasses = {
    small: 'flex flex-col gap-1.5',
    medium: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 lg:gap-8',
    large: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5 md:gap-6 lg:gap-10',
  }

  const anyRaffles = otherRaffles.length > 0

  if (!anyRaffles) {
    return null
  }

  const showSort =
    otherRaffles.length + heatingUpRaffles.length + profitableRaffles.length > 1

  const renderRaffleCard = (
    { raffle, entries, profitInfo, entryStats }: RaffleWithEntriesItem,
    flatIndex: number
  ) => {
    const creator = (raffle.creator_wallet || raffle.created_by || '').trim()
    const feeReason = (raffle.fee_tier_reason ?? '').trim()
    const isPartnerCommunity =
      raffle.creator_is_partner === true ||
      Boolean(raffle.discord_partner_tenant_id && String(raffle.discord_partner_tenant_id).trim()) ||
      feeReason === 'partner_community' ||
      (creator ? partnerWalletSet?.has(creator) ?? false : false)
    return (
      <RaffleScrollReveal key={raffle.id}>
        <RaffleCard
          raffle={raffle}
          entries={entries}
          size={size}
          section={section}
          profitInfo={profitInfo}
          entryStats={entryStats}
          onDeleted={handleRaffleDeleted}
          priority={flatIndex < (isMobile ? 3 : 6)}
          serverNow={serverNow}
          isPartnerCommunity={isPartnerCommunity}
        />
      </RaffleScrollReveal>
    )
  }

  return (
    <div className="w-full min-w-0">
      {(title || showSort) && (
        <div className="mb-4 sm:mb-6 space-y-3">
          <div
            className={
              title
                ? 'flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-2'
                : 'flex flex-row flex-wrap items-center justify-end gap-3'
            }
          >
            {title ? <h2 className="text-xl sm:text-2xl font-bold min-w-0">{title}</h2> : null}
            {showSort && (
              <div className={`flex items-center gap-2 shrink-0 ${title ? 'sm:ml-auto' : ''}`}>
                <label htmlFor="sort-select" className="text-sm text-muted-foreground whitespace-nowrap">
                  Sort by:
                </label>
                <select
                  id="sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer touch-manipulation"
                >
                  <option value="days-left">Days Left</option>
                  <option value="date">Date</option>
                  <option value="ticket-price">Ticket Price</option>
                </select>
              </div>
            )}
          </div>
          {titleDescription ? <div className="text-sm text-muted-foreground">{titleDescription}</div> : null}
        </div>
      )}
      <div className={`w-full min-w-0 ${gridClasses[size]}`}>
        {otherRaffles.map(({ raffle, entries, profitInfo }, index) =>
          renderRaffleCard({ raffle, entries, profitInfo }, index)
        )}
      </div>
    </div>
  )
}
