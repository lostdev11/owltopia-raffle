'use client'

import { useCallback, useEffect, useId, useRef } from 'react'
import { Search, X } from 'lucide-react'
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

  const clearAll = useCallback(() => {
    onQueryChange('')
    onTicketCurrencyChange(null)
    onPrizeChange(null)
    inputRef.current?.focus()
  }, [onQueryChange, onTicketCurrencyChange, onPrizeChange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && hasFilters) {
        e.preventDefault()
        clearAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasFilters, clearAll])

  return (
    <section
      className={cn(
        'rounded-xl border border-border/90 bg-muted/25 p-3 shadow-sm dark:border-border/60 dark:bg-muted/15 sm:p-4',
        className
      )}
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
              Showing <span className="font-medium text-foreground">{resultCount}</span> of {totalCount}
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
    </section>
  )
}
