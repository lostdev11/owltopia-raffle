'use client'

import { useCallback, useEffect, useId, useRef, useState, type SyntheticEvent } from 'react'
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import { cn } from '@/lib/utils'
import type { RaffleCurrency } from '@/lib/types'
import { RAFFLE_CURRENCIES } from '@/lib/tokens'
import type {
  RaffleBrowsePrizeFilter,
  RaffleBrowseTicketCurrencyFilter,
} from '@/lib/raffles/filter-browse-raffles'

const TICKET_FILTER_OPTIONS: { value: RaffleBrowseTicketCurrencyFilter; label: string }[] = [
  { value: null, label: 'All' },
  ...RAFFLE_CURRENCIES.map((c) => ({ value: c as RaffleCurrency, label: c })),
]

const PRIZE_FILTER_OPTIONS: { value: RaffleBrowsePrizeFilter; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'SOL', label: 'SOL prize' },
  { value: 'USDC', label: 'USDC prize' },
]

interface FilterChipRowProps<T extends string | null> {
  label: string
  ariaLabel: string
  options: { value: T; label: string }[]
  selected: T
  onSelect: (value: T) => void
  showIcon?: boolean
}

function FilterChipRow<T extends string | null>({
  label,
  ariaLabel,
  options,
  selected,
  onSelect,
  showIcon = true,
}: FilterChipRowProps<T>) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-14">
        {label}
      </span>
      <div
        className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]"
        role="group"
        aria-label={ariaLabel}
      >
        {options.map((opt) => {
          const isSelected = opt.value === null ? selected === null : selected === opt.value
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => onSelect(opt.value)}
              className={cn(
                'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium touch-manipulation transition-colors',
                isSelected
                  ? 'border-green-500/40 bg-background text-foreground shadow-sm ring-1 ring-green-500/20'
                  : 'border-transparent bg-background/60 text-muted-foreground hover:bg-background hover:text-foreground'
              )}
              aria-pressed={isSelected}
            >
              {showIcon && opt.value ? (
                <CurrencyIcon currency={opt.value} size={16} className="shrink-0" />
              ) : null}
              <span className="whitespace-nowrap">{opt.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function collapsedFilterSummary(
  query: string,
  ticketCurrency: RaffleBrowseTicketCurrencyFilter,
  prize: RaffleBrowsePrizeFilter
): string | null {
  const parts: string[] = []
  const q = query.trim()
  if (q) parts.push(q.length > 24 ? `${q.slice(0, 24)}…` : q)
  if (ticketCurrency) parts.push(`${ticketCurrency} tickets`)
  if (prize) parts.push(`${prize} prize`)
  return parts.length > 0 ? parts.join(' · ') : null
}

interface RafflesBrowseToolbarProps {
  query: string
  onQueryChange: (value: string) => void
  ticketCurrency: RaffleBrowseTicketCurrencyFilter
  onTicketCurrencyChange: (value: RaffleBrowseTicketCurrencyFilter) => void
  prize: RaffleBrowsePrizeFilter
  onPrizeChange: (value: RaffleBrowsePrizeFilter) => void
  resultCount: number
  totalCount: number
  className?: string
}

export function RafflesBrowseToolbar({
  query,
  onQueryChange,
  ticketCurrency,
  onTicketCurrencyChange,
  prize,
  onPrizeChange,
  resultCount,
  totalCount,
  className,
}: RafflesBrowseToolbarProps) {
  const searchId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const hasFilters = Boolean(query.trim() || ticketCurrency || prize)
  const filterSummary = collapsedFilterSummary(query, ticketCurrency, prize)

  const [open, setOpen] = useState(() => hasFilters)

  const clearAll = useCallback(() => {
    onQueryChange('')
    onTicketCurrencyChange(null)
    onPrizeChange(null)
    inputRef.current?.focus()
  }, [onQueryChange, onTicketCurrencyChange, onPrizeChange])

  const onToggle = useCallback((e: SyntheticEvent<HTMLDetailsElement>) => {
    const next = e.currentTarget.open
    setOpen(next)
    if (next) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (open && hasFilters) {
        e.preventDefault()
        clearAll()
        return
      }
      if (open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, hasFilters, clearAll])

  return (
    <details
      open={open}
      onToggle={onToggle}
      className={cn(
        'group rounded-xl border border-border/90 bg-muted/25 shadow-sm dark:border-border/60 dark:bg-muted/15',
        className
      )}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 touch-manipulation min-h-[44px] sm:px-4 sm:py-3 [&::-webkit-details-marker]:hidden"
        aria-label={open ? 'Collapse search and filters' : 'Expand search and filters'}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background/80 text-muted-foreground ring-1 ring-border/60">
          {hasFilters ? (
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
          ) : (
            <Search className="h-4 w-4" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-medium leading-tight text-foreground">
            Search &amp; filters
          </span>
          {!open ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {filterSummary ??
                (hasFilters
                  ? `Showing ${resultCount} of ${totalCount}`
                  : `Tap to search · ${totalCount} raffles`)}
            </span>
          ) : null}
        </span>
        {hasFilters && !open ? (
          <span className="shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-600 dark:text-green-400">
            On
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            'h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180'
          )}
          aria-hidden
        />
      </summary>

      <div
        className="border-t border-border/70 px-3 pb-3 pt-3 sm:px-4 sm:pb-4 dark:border-border/50"
        aria-label="Search and filter raffles"
      >
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">
            Search raffles by name
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={inputRef}
            id={searchId}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Search raffles (e.g. Pandarianz)"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="min-h-[44px] touch-manipulation pl-9 pr-10 text-base sm:text-sm"
          />
          {query.trim() ? (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="absolute right-1 top-1/2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground touch-manipulation"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="mt-3 space-y-2.5">
          <FilterChipRow
            label="Tickets"
            ariaLabel="Filter by ticket payment currency"
            options={TICKET_FILTER_OPTIONS}
            selected={ticketCurrency}
            onSelect={onTicketCurrencyChange}
          />
          <FilterChipRow
            label="Prize"
            ariaLabel="Filter by crypto prize currency"
            options={PRIZE_FILTER_OPTIONS}
            selected={prize}
            onSelect={onPrizeChange}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {hasFilters ? (
              <>
                Showing <span className="font-medium text-foreground">{resultCount}</span> of{' '}
                {totalCount}
              </>
            ) : (
              <>{totalCount} raffles</>
            )}
          </p>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearAll}
              className="text-sm font-medium text-green-600 hover:underline dark:text-green-400 touch-manipulation min-h-[44px] inline-flex items-center px-1"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>
    </details>
  )
}
