'use client'

import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { RafflesBrowseToolbar } from '@/components/RafflesBrowseToolbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, ChevronDown, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
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

type AdminListBucket =
  | 'pending-cancellation'
  | 'active'
  | 'paused'
  | 'future'
  | 'escrow-recovery'
  | 'past'

type AdminListItem = RaffleWithEntriesAndProfit & { bucket: AdminListBucket }

interface AdminRafflesPageClientProps {
  activeRafflesWithEntries: RaffleWithEntriesAndProfit[]
  futureRafflesWithEntries: RaffleWithEntriesAndProfit[]
  pastRafflesWithEntries: RaffleWithEntriesAndProfit[]
  pausedPendingRafflesWithEntries: RaffleWithEntriesAndProfit[]
  cancelledRecoveryRafflesWithEntries: RaffleWithEntriesAndProfit[]
  pendingCancellationRafflesWithEntries: RaffleWithEntriesAndProfit[]
}

const BUCKET_LABEL: Record<AdminListBucket, string> = {
  'pending-cancellation': 'Cancel request',
  active: 'Live',
  paused: 'Paused / escrow',
  future: 'Scheduled',
  'escrow-recovery': 'NFT in escrow',
  past: 'Ended',
}

const PAGE_SIZE = 40

function withBucket(items: RaffleWithEntriesAndProfit[], bucket: AdminListBucket): AdminListItem[] {
  return items.map((item) => ({ ...item, bucket }))
}

function statusLabel(raffle: Raffle): string {
  const status = (raffle.status ?? '').trim()
  return status || (raffle.is_active ? 'active' : 'ended')
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function CollapsiblePanel({
  id,
  title,
  count,
  description,
  defaultOpen,
  open,
  onOpenChange,
  children,
}: {
  id?: string
  title: string
  count: number
  description?: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}) {
  const controlled = typeof open === 'boolean'
  const [uncontrolledOpen, setUncontrolledOpen] = useState(Boolean(defaultOpen))
  const isOpen = controlled ? open : uncontrolledOpen

  return (
    <details
      id={id}
      open={isOpen}
      onToggle={(e) => {
        const next = e.currentTarget.open
        if (!controlled) setUncontrolledOpen(next)
        onOpenChange?.(next)
      }}
      className={cn(
        'mb-4 rounded-xl border border-border/80 bg-muted/20 scroll-mt-24',
        'dark:border-border/50 dark:bg-muted/10'
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 touch-manipulation min-h-[52px] sm:px-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-base font-semibold sm:text-lg">
            {title}{' '}
            <span className="font-medium text-muted-foreground">({count})</span>
          </span>
          {description ? (
            <span className="mt-0.5 block text-xs text-muted-foreground sm:text-sm">{description}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            'h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
          aria-hidden
        />
      </summary>
      {/* Only mount children when open — avoids rendering huge card/list trees while collapsed. */}
      {isOpen ? <div className="border-t border-border/60 px-3 pb-3 pt-3 sm:px-4 sm:pb-4">{children}</div> : null}
    </details>
  )
}

function AdminRaffleCompactList({
  items,
  emptyMessage,
}: {
  items: AdminListItem[]
  emptyMessage: string
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [items])

  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
  }

  const visible = items.slice(0, visibleCount)
  const remaining = items.length - visible.length

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70 bg-background/60">
        {visible.map(({ raffle, bucket }) => (
          <li key={raffle.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate font-medium leading-tight">{raffle.title}</p>
                <Badge variant="secondary" className="shrink-0 text-[10px] uppercase tracking-wide">
                  {BUCKET_LABEL[bucket]}
                </Badge>
                <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
                  {statusLabel(raffle)}
                </Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground sm:text-sm">
                /{raffle.slug}
                <span className="mx-1.5 text-border">·</span>
                ends {formatShortDate(raffle.end_time)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button asChild variant="outline" size="sm" className="min-h-[40px] touch-manipulation">
                <Link href={`/admin/raffles/${raffle.id}`}>Manage</Link>
              </Button>
              <Button asChild variant="ghost" size="icon" className="min-h-[40px] min-w-[40px] touch-manipulation">
                <Link href={`/raffles/${raffle.slug}`} aria-label={`View ${raffle.title}`}>
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {remaining > 0 ? (
        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] touch-manipulation"
            onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          >
            Show more ({remaining} remaining)
          </Button>
        </div>
      ) : null}
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

  const filtered = useMemo(
    () => ({
      pendingCancellation: filterRafflesBrowseList(pendingCancellationRafflesWithEntries, browseFilters),
      active: filterRafflesBrowseList(activeRafflesWithEntries, browseFilters),
      pausedPending: filterRafflesBrowseList(pausedPendingRafflesWithEntries, browseFilters),
      cancelledRecovery: filterRafflesBrowseList(cancelledRecoveryRafflesWithEntries, browseFilters),
      future: filterRafflesBrowseList(futureRafflesWithEntries, browseFilters),
      past: filterRafflesBrowseList(pastRafflesWithEntries, browseFilters),
    }),
    [
      pendingCancellationRafflesWithEntries,
      activeRafflesWithEntries,
      pausedPendingRafflesWithEntries,
      cancelledRecoveryRafflesWithEntries,
      futureRafflesWithEntries,
      pastRafflesWithEntries,
      browseFilters,
    ]
  )

  const activeItems = useMemo(
    () => [
      ...withBucket(filtered.pendingCancellation, 'pending-cancellation'),
      ...withBucket(filtered.active, 'active'),
      ...withBucket(filtered.pausedPending, 'paused'),
      ...withBucket(filtered.future, 'future'),
    ],
    [filtered]
  )

  const endedItems = useMemo(
    () => [
      ...withBucket(filtered.cancelledRecovery, 'escrow-recovery'),
      ...withBucket(filtered.past, 'past'),
    ],
    [filtered]
  )

  const totalCount =
    activeRafflesWithEntries.length +
    futureRafflesWithEntries.length +
    pastRafflesWithEntries.length +
    pausedPendingRafflesWithEntries.length +
    cancelledRecoveryRafflesWithEntries.length +
    pendingCancellationRafflesWithEntries.length

  const resultCount = activeItems.length + endedItems.length
  const nothingToShow = resultCount === 0

  const pendingCancelCount = filtered.pendingCancellation.length
  const [activeOpen, setActiveOpen] = useState(pendingCancelCount > 0)
  const [endedOpen, setEndedOpen] = useState(false)

  // Deep-link / queue scroll opens the Active panel (pending cancellation lives there).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const queue = params.get('queue')
    const shouldOpenActive =
      window.location.hash === '#pending-cancellation' ||
      queue === 'pending-cancellation' ||
      queue === 'cancellation'
    if (!shouldOpenActive) return

    setActiveOpen(true)
    let cancelled = false
    const scrollToQueue = () => {
      if (cancelled) return
      document.getElementById('active-raffles')?.scrollIntoView({
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

  // While searching, open groups that have hits so results are visible without extra taps.
  useEffect(() => {
    if (!filtersActive) return
    if (activeItems.length > 0) setActiveOpen(true)
    if (endedItems.length > 0) setEndedOpen(true)
  }, [filtersActive, activeItems.length, endedItems.length])

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
          Search, then expand Active or Ended. Lists stay collapsed so the page stays light on mobile.
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
      ) : nothingToShow ? (
        <div className="text-center py-16">
          <p className="text-xl text-muted-foreground mb-4">No raffles available</p>
        </div>
      ) : (
        <>
          <CollapsiblePanel
            id="active-raffles"
            title="Active raffles"
            count={activeItems.length}
            description={
              pendingCancelCount > 0
                ? `${pendingCancelCount} pending cancellation · live, paused, and scheduled`
                : 'Live, paused / escrow, and scheduled'
            }
            open={activeOpen}
            onOpenChange={setActiveOpen}
          >
            <AdminRaffleCompactList
              items={activeItems}
              emptyMessage="No active raffles."
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            id="ended-raffles"
            title="Ended raffles"
            count={endedItems.length}
            description="Completed, cancelled, and NFT escrow recovery"
            open={endedOpen}
            onOpenChange={setEndedOpen}
          >
            <AdminRaffleCompactList
              items={endedItems}
              emptyMessage="No ended raffles."
            />
          </CollapsiblePanel>
        </>
      )}
    </div>
  )
}
