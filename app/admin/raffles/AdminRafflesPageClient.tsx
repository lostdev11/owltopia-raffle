'use client'

import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { RafflesList } from '@/components/RafflesList'
import { RafflesBrowseToolbar } from '@/components/RafflesBrowseToolbar'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import type { Raffle, Entry } from '@/lib/types'
import type { RaffleProfitInfo } from '@/lib/raffle-profit'
import {
  filterRafflesBrowseList,
  hasActiveBrowseFilters,
  prizeFilterFromSearchParam,
  ticketCurrencyFilterFromSearchParam,
  type RaffleBrowsePrizeFilter,
  type RaffleBrowseTicketCurrencyFilter,
} from '@/lib/raffles/filter-browse-raffles'

export type RaffleWithEntriesAndProfit = { raffle: Raffle; entries: Entry[]; profitInfo: RaffleProfitInfo }

interface AdminRafflesPageClientProps {
  activeRafflesWithEntries: RaffleWithEntriesAndProfit[]
  futureRafflesWithEntries: RaffleWithEntriesAndProfit[]
  pastRafflesWithEntries: RaffleWithEntriesAndProfit[]
  pausedPendingRafflesWithEntries: RaffleWithEntriesAndProfit[]
  cancelledRecoveryRafflesWithEntries: RaffleWithEntriesAndProfit[]
  pendingCancellationRafflesWithEntries: RaffleWithEntriesAndProfit[]
}

function AdminRaffleSection({
  id,
  title,
  description,
  items,
  section,
  emptyUnfiltered,
  filtersActive,
  onRaffleDeleted,
}: {
  id?: string
  title: string
  description?: ReactNode
  items: RaffleWithEntriesAndProfit[]
  section: 'active' | 'future' | 'past'
  emptyUnfiltered: string
  filtersActive: boolean
  onRaffleDeleted: (raffleId: string) => void
}) {
  // While searching, skip empty buckets so results stay scannable.
  if (filtersActive && items.length === 0) return null

  return (
    <div id={id} className={`mb-8 sm:mb-12${id ? ' scroll-mt-24' : ''}`}>
      <h2 className="text-xl sm:text-2xl font-bold mb-2 sm:mb-3">
        {title}
      </h2>
      {description ? <div className="text-sm text-muted-foreground mb-4 sm:mb-6">{description}</div> : null}
      {items.length > 0 ? (
        <RafflesList
          rafflesWithEntries={items}
          title={undefined}
          section={section}
          onRaffleDeleted={onRaffleDeleted}
        />
      ) : (
        <div className="text-center py-8">
          <p className="text-muted-foreground">{emptyUnfiltered}</p>
        </div>
      )}
    </div>
  )
}

export function AdminRafflesPageClient({
  activeRafflesWithEntries,
  futureRafflesWithEntries,
  pastRafflesWithEntries,
  pausedPendingRafflesWithEntries,
  cancelledRecoveryRafflesWithEntries,
  pendingCancellationRafflesWithEntries,
}: AdminRafflesPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [browseQuery, setBrowseQuery] = useState(() => searchParams.get('q') ?? '')
  const [browseTicketCurrency, setBrowseTicketCurrency] = useState<RaffleBrowseTicketCurrencyFilter>(
    () => ticketCurrencyFilterFromSearchParam(searchParams.get('currency'))
  )
  const [browsePrize, setBrowsePrize] = useState<RaffleBrowsePrizeFilter>(() =>
    prizeFilterFromSearchParam(searchParams.get('prize'))
  )

  const browseFilters = useMemo(
    () => ({ query: browseQuery, ticketCurrency: browseTicketCurrency, prize: browsePrize }),
    [browseQuery, browseTicketCurrency, browsePrize]
  )
  const filtersActive = hasActiveBrowseFilters(browseFilters)

  const replaceBrowseFiltersInUrl = useCallback(
    (next: {
      query: string
      ticketCurrency: RaffleBrowseTicketCurrencyFilter
      prize: RaffleBrowsePrizeFilter
    }) => {
      const params = new URLSearchParams(searchParams.toString())
      const q = next.query.trim()
      if (q) params.set('q', q)
      else params.delete('q')
      if (next.ticketCurrency) params.set('currency', next.ticketCurrency)
      else params.delete('currency')
      if (next.prize) params.set('prize', next.prize)
      else params.delete('prize')
      const qs = params.toString()
      router.replace(qs ? `/admin/raffles?${qs}` : '/admin/raffles', { scroll: false })
    },
    [router, searchParams]
  )

  useEffect(() => {
    const urlQ = (searchParams.get('q') ?? '').trim()
    const urlCur = ticketCurrencyFilterFromSearchParam(searchParams.get('currency'))
    const urlPrize = prizeFilterFromSearchParam(searchParams.get('prize'))
    if (browseQuery.trim() === urlQ && browseTicketCurrency === urlCur && browsePrize === urlPrize) return
    const t = setTimeout(() => {
      replaceBrowseFiltersInUrl({
        query: browseQuery,
        ticketCurrency: browseTicketCurrency,
        prize: browsePrize,
      })
    }, 350)
    return () => clearTimeout(t)
  }, [browseQuery, browseTicketCurrency, browsePrize, searchParams, replaceBrowseFiltersInUrl])

  const handleBrowseTicketCurrencyChange = useCallback(
    (value: RaffleBrowseTicketCurrencyFilter) => {
      setBrowseTicketCurrency(value)
      replaceBrowseFiltersInUrl({ query: browseQuery, ticketCurrency: value, prize: browsePrize })
    },
    [browseQuery, browsePrize, replaceBrowseFiltersInUrl]
  )

  const handleBrowsePrizeChange = useCallback(
    (value: RaffleBrowsePrizeFilter) => {
      setBrowsePrize(value)
      replaceBrowseFiltersInUrl({ query: browseQuery, ticketCurrency: browseTicketCurrency, prize: value })
    },
    [browseQuery, browseTicketCurrency, replaceBrowseFiltersInUrl]
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const queue = params.get('queue')
    const shouldScroll =
      window.location.hash === '#pending-cancellation' ||
      queue === 'pending-cancellation' ||
      queue === 'cancellation'
    if (!shouldScroll) return

    let cancelled = false
    const scrollToQueue = () => {
      if (cancelled) return
      document.getElementById('pending-cancellation')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
    scrollToQueue()
    const t = window.setTimeout(scrollToQueue, 120)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [])

  const [rafflesState, setRafflesState] = useState({
    active: activeRafflesWithEntries,
    future: futureRafflesWithEntries,
    past: pastRafflesWithEntries,
    pausedPending: pausedPendingRafflesWithEntries,
    cancelledRecovery: cancelledRecoveryRafflesWithEntries,
    pendingCancellation: pendingCancellationRafflesWithEntries,
  })

  const handleRaffleDeleted = useCallback((raffleId: string) => {
    setRafflesState(prev => ({
      active: prev.active.filter(({ raffle }) => raffle.id !== raffleId),
      future: prev.future.filter(({ raffle }) => raffle.id !== raffleId),
      past: prev.past.filter(({ raffle }) => raffle.id !== raffleId),
      pausedPending: prev.pausedPending.filter(({ raffle }) => raffle.id !== raffleId),
      cancelledRecovery: prev.cancelledRecovery.filter(({ raffle }) => raffle.id !== raffleId),
      pendingCancellation: prev.pendingCancellation.filter(({ raffle }) => raffle.id !== raffleId),
    }))

    setTimeout(() => {
      router.refresh()
    }, 500)
  }, [router])

  const filtered = useMemo(
    () => ({
      pendingCancellation: filterRafflesBrowseList(rafflesState.pendingCancellation, browseFilters),
      active: filterRafflesBrowseList(rafflesState.active, browseFilters),
      pausedPending: filterRafflesBrowseList(rafflesState.pausedPending, browseFilters),
      cancelledRecovery: filterRafflesBrowseList(rafflesState.cancelledRecovery, browseFilters),
      future: filterRafflesBrowseList(rafflesState.future, browseFilters),
      past: filterRafflesBrowseList(rafflesState.past, browseFilters),
    }),
    [rafflesState, browseFilters]
  )

  const totalCount =
    rafflesState.active.length +
    rafflesState.future.length +
    rafflesState.past.length +
    rafflesState.pausedPending.length +
    rafflesState.cancelledRecovery.length +
    rafflesState.pendingCancellation.length

  const resultCount =
    filtered.active.length +
    filtered.future.length +
    filtered.past.length +
    filtered.pausedPending.length +
    filtered.cancelledRecovery.length +
    filtered.pendingCancellation.length

  const nothingToShow = resultCount === 0

  return (
    <div className="container mx-auto py-4 sm:py-6 md:py-8 px-3 sm:px-4">
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/admin">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Owl Vision
            </Button>
          </Link>
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-2">
          Admin - Manage Raffles
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground">
          View and manage all raffles, including past raffles. Search by title, slug, ID, mint, creator, or winner.
        </p>
      </div>

      <div className="mb-6 sm:mb-8">
        <RafflesBrowseToolbar
          query={browseQuery}
          onQueryChange={setBrowseQuery}
          ticketCurrency={browseTicketCurrency}
          onTicketCurrencyChange={handleBrowseTicketCurrencyChange}
          prize={browsePrize}
          onPrizeChange={handleBrowsePrizeChange}
          resultCount={resultCount}
          totalCount={totalCount}
          searchPlaceholder="Search by title, slug, ID, mint, wallet…"
        />
      </div>

      {filtersActive && nothingToShow ? (
        <div className="text-center py-16">
          <p className="text-xl text-muted-foreground mb-4">No raffles match your search.</p>
        </div>
      ) : (
        <>
          <AdminRaffleSection
            id="pending-cancellation"
            title="Pending cancellation"
            description={
              <>
                Creators who requested cancellation — open each raffle in Owl Vision to accept or review. Post-start
                raffles need the on-chain cancellation fee paid before you can complete cancellation.
              </>
            }
            items={filtered.pendingCancellation}
            section="active"
            emptyUnfiltered="No pending cancellation requests."
            filtersActive={filtersActive}
            onRaffleDeleted={handleRaffleDeleted}
          />

          <AdminRaffleSection
            title="Active Raffles"
            items={filtered.active}
            section="active"
            emptyUnfiltered="No active raffles at the moment."
            filtersActive={filtersActive}
            onRaffleDeleted={handleRaffleDeleted}
          />

          <AdminRaffleSection
            title="Paused / Pending Escrow Verification"
            items={filtered.pausedPending}
            section="future"
            emptyUnfiltered="No paused or pending escrow raffles."
            filtersActive={filtersActive}
            onRaffleDeleted={handleRaffleDeleted}
          />

          <AdminRaffleSection
            title="NFT prize still in escrow (ended or cancelled)"
            description={
              <>
                Ended or cancelled NFT raffles where the prize is still held in escrow (no on-chain transfer to a winner
                yet). Use this to return NFTs to creators, including legacy raffles that only have a verified deposit
                timestamp.
              </>
            }
            items={filtered.cancelledRecovery}
            section="past"
            emptyUnfiltered="No cancelled NFT raffles need prize return."
            filtersActive={filtersActive}
            onRaffleDeleted={handleRaffleDeleted}
          />

          <AdminRaffleSection
            title="Future Raffles"
            items={filtered.future}
            section="future"
            emptyUnfiltered="No upcoming raffles scheduled at this time"
            filtersActive={filtersActive}
            onRaffleDeleted={handleRaffleDeleted}
          />

          <AdminRaffleSection
            title={
              filtersActive && rafflesState.past.length !== filtered.past.length
                ? `Past Raffles (${filtered.past.length} of ${rafflesState.past.length})`
                : `Past Raffles (${filtered.past.length})`
            }
            items={filtered.past}
            section="past"
            emptyUnfiltered="No past raffles found."
            filtersActive={filtersActive}
            onRaffleDeleted={handleRaffleDeleted}
          />

          {!filtersActive && nothingToShow && (
            <div className="text-center py-16">
              <p className="text-xl text-muted-foreground mb-4">No raffles available</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
