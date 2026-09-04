'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type SyntheticEvent } from 'react'
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
import {
  classifyHostResolve,
  suggestHosts,
  type HostCandidate,
} from '@/lib/raffles/resolve-host-filter'
import {
  classifyCollectionResolve,
  suggestCollections,
  type CollectionCandidate,
} from '@/lib/raffles/resolve-collection-filter'

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
  prize: RaffleBrowsePrizeFilter,
  hostLabel: string | null,
  collectionLabel: string | null
): string | null {
  const parts: string[] = []
  const q = query.trim()
  if (q) parts.push(q.length > 24 ? `${q.slice(0, 24)}…` : q)
  if (ticketCurrency) parts.push(`${ticketCurrency} tickets`)
  if (prize) parts.push(`${prize} prize`)
  if (hostLabel?.trim()) {
    const h = hostLabel.trim()
    parts.push(`Host: ${h.length > 18 ? `${h.slice(0, 18)}…` : h}`)
  }
  if (collectionLabel?.trim()) {
    const c = collectionLabel.trim()
    parts.push(`Project: ${c.length > 18 ? `${c.slice(0, 18)}…` : c}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

interface RafflesBrowseToolbarProps {
  query: string
  onQueryChange: (value: string) => void
  ticketCurrency: RaffleBrowseTicketCurrencyFilter
  onTicketCurrencyChange: (value: RaffleBrowseTicketCurrencyFilter) => void
  prize: RaffleBrowsePrizeFilter
  onPrizeChange: (value: RaffleBrowsePrizeFilter) => void
  /** Active host wallet filter (`?host=`). Omit / leave unset to hide host UI (e.g. admin). */
  hostWallet?: string | null
  /** Display label for the active host chip (name or truncated wallet). */
  hostLabel?: string | null
  /** Apply or clear wallet-backed host filter. Required to show the Host control. */
  onHostChange?: (wallet: string | null, label?: string | null) => void
  /** Unique hosts from the loaded browse list (for typeahead + name resolve). */
  hostCandidates?: HostCandidate[]
  /** Active collection mint filter (`?collection=`). */
  collectionMint?: string | null
  collectionLabel?: string | null
  onCollectionChange?: (mint: string | null, label?: string | null) => void
  collectionCandidates?: CollectionCandidate[]
  resultCount: number
  totalCount: number
  className?: string
  /** Override search input placeholder (defaults to public browse copy). */
  searchPlaceholder?: string
}

export function RafflesBrowseToolbar({
  query,
  onQueryChange,
  ticketCurrency,
  onTicketCurrencyChange,
  prize,
  onPrizeChange,
  hostWallet = null,
  hostLabel = null,
  onHostChange,
  hostCandidates = [],
  collectionMint = null,
  collectionLabel = null,
  onCollectionChange,
  collectionCandidates = [],
  resultCount,
  totalCount,
  className,
  searchPlaceholder = 'Search raffles (e.g. Pandarianz)',
}: RafflesBrowseToolbarProps) {
  const searchId = useId()
  const hostId = useId()
  const collectionId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const hostInputRef = useRef<HTMLInputElement>(null)
  const collectionInputRef = useRef<HTMLInputElement>(null)
  const showHostFilter = typeof onHostChange === 'function'
  const showCollectionFilter = typeof onCollectionChange === 'function'
  const hasHost = Boolean(showHostFilter && hostWallet?.trim())
  const hasCollection = Boolean(showCollectionFilter && collectionMint?.trim())
  const hasFilters = Boolean(query.trim() || ticketCurrency || prize || hasHost || hasCollection)
  const filterSummary = collapsedFilterSummary(
    query,
    ticketCurrency,
    prize,
    showHostFilter ? hostLabel : null,
    showCollectionFilter ? collectionLabel : null
  )

  const [open, setOpen] = useState(() => hasFilters)
  const [hostDraft, setHostDraft] = useState('')
  const [hostMessage, setHostMessage] = useState<string | null>(null)
  const [ambiguousHosts, setAmbiguousHosts] = useState<HostCandidate[] | null>(null)
  const [collectionDraft, setCollectionDraft] = useState('')
  const [collectionMessage, setCollectionMessage] = useState<string | null>(null)
  const [ambiguousCollections, setAmbiguousCollections] = useState<CollectionCandidate[] | null>(null)
  const [apiCollectionHits, setApiCollectionHits] = useState<CollectionCandidate[]>([])

  const mergedCollectionCandidates = useMemo(() => {
    const byMint = new Map<string, CollectionCandidate>()
    for (const c of [...collectionCandidates, ...apiCollectionHits]) {
      const key = c.mint
      if (!key || byMint.has(key)) continue
      byMint.set(key, c)
    }
    return [...byMint.values()]
  }, [collectionCandidates, apiCollectionHits])

  const suggestions = useMemo(
    () => suggestHosts(hostDraft, hostCandidates),
    [hostDraft, hostCandidates]
  )

  const collectionSuggestions = useMemo(
    () => suggestCollections(collectionDraft, mergedCollectionCandidates),
    [collectionDraft, mergedCollectionCandidates]
  )

  useEffect(() => {
    if (!showCollectionFilter) return
    const q = collectionDraft.trim()
    if (q.length < 2) {
      setApiCollectionHits([])
      return
    }
    const t = setTimeout(() => {
      fetch(`/api/projects/suggest?q=${encodeURIComponent(q)}`)
        .then((res) => (res.ok ? res.json() : { projects: [] }))
        .then((data) => {
          const projects = Array.isArray(data?.projects) ? data.projects : []
          setApiCollectionHits(
            projects
              .map((p: { collection_mint?: string; display_name?: string }) => {
                const mint = typeof p.collection_mint === 'string' ? p.collection_mint.trim() : ''
                if (!mint) return null
                return { mint, label: (p.display_name || '').trim() || mint }
              })
              .filter((c: CollectionCandidate | null): c is CollectionCandidate => c !== null)
          )
        })
        .catch(() => setApiCollectionHits([]))
    }, 280)
    return () => clearTimeout(t)
  }, [collectionDraft, showCollectionFilter])

  const clearHostUi = useCallback(() => {
    setHostDraft('')
    setHostMessage(null)
    setAmbiguousHosts(null)
  }, [])

  const clearCollectionUi = useCallback(() => {
    setCollectionDraft('')
    setCollectionMessage(null)
    setAmbiguousCollections(null)
    setApiCollectionHits([])
  }, [])

  const clearAll = useCallback(() => {
    onQueryChange('')
    onTicketCurrencyChange(null)
    onPrizeChange(null)
    onHostChange?.(null, null)
    onCollectionChange?.(null, null)
    clearHostUi()
    clearCollectionUi()
    inputRef.current?.focus()
  }, [
    onQueryChange,
    onTicketCurrencyChange,
    onPrizeChange,
    onHostChange,
    onCollectionChange,
    clearHostUi,
    clearCollectionUi,
  ])

  const applyHost = useCallback(
    (host: HostCandidate) => {
      onHostChange?.(host.wallet, host.label)
      clearHostUi()
    },
    [onHostChange, clearHostUi]
  )

  const applyCollection = useCallback(
    (collection: CollectionCandidate) => {
      onCollectionChange?.(collection.mint, collection.label)
      clearCollectionUi()
    },
    [onCollectionChange, clearCollectionUi]
  )

  const submitHostDraft = useCallback(() => {
    const outcome = classifyHostResolve(hostDraft, hostCandidates)
    if (outcome.status === 'empty') {
      setHostMessage(null)
      setAmbiguousHosts(null)
      return
    }
    if (outcome.status === 'none') {
      setAmbiguousHosts(null)
      setHostMessage('No host found for that name or wallet.')
      return
    }
    if (outcome.status === 'one') {
      applyHost(outcome.host)
      return
    }
    setHostMessage(`Multiple hosts matched “${hostDraft.trim()}”. Pick one:`)
    setAmbiguousHosts(outcome.hosts.slice(0, 12))
  }, [hostDraft, hostCandidates, applyHost])

  const submitCollectionDraft = useCallback(() => {
    const outcome = classifyCollectionResolve(collectionDraft, mergedCollectionCandidates)
    if (outcome.status === 'empty') {
      setCollectionMessage(null)
      setAmbiguousCollections(null)
      return
    }
    if (outcome.status === 'none') {
      setAmbiguousCollections(null)
      setCollectionMessage('No project found for that name or collection mint.')
      return
    }
    if (outcome.status === 'one') {
      applyCollection(outcome.collection)
      return
    }
    setCollectionMessage(`Multiple projects matched “${collectionDraft.trim()}”. Pick one:`)
    setAmbiguousCollections(outcome.collections.slice(0, 12))
  }, [collectionDraft, mergedCollectionCandidates, applyCollection])

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
            Search raffles
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
            placeholder={searchPlaceholder}
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

          {showHostFilter ? (
            <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
              <span className="shrink-0 pt-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-14">
                Host
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                {hasHost ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-green-500/40 bg-background px-3 py-2 text-sm font-medium shadow-sm ring-1 ring-green-500/20">
                      <span className="truncate">Host: {hostLabel?.trim() || hostWallet}</span>
                      <button
                        type="button"
                        onClick={() => {
                          onHostChange?.(null, null)
                          clearHostUi()
                        }}
                        className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded-md text-muted-foreground hover:text-foreground touch-manipulation"
                        aria-label="Clear host filter"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <label htmlFor={hostId} className="sr-only">
                        Filter by host name or wallet
                      </label>
                      <Input
                        ref={hostInputRef}
                        id={hostId}
                        type="search"
                        enterKeyHint="search"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="Host name or wallet (e.g. Devdad)"
                        value={hostDraft}
                        onChange={(e) => {
                          setHostDraft(e.target.value)
                          setHostMessage(null)
                          setAmbiguousHosts(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            submitHostDraft()
                          }
                        }}
                        className="min-h-[44px] touch-manipulation text-base sm:text-sm"
                      />
                      <button
                        type="button"
                        onClick={submitHostDraft}
                        className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium touch-manipulation hover:bg-muted/60"
                      >
                        Apply
                      </button>
                    </div>
                    {suggestions.length > 0 ? (
                      <ul
                        className="max-h-40 overflow-y-auto rounded-lg border border-border/70 bg-background py-1 text-sm shadow-sm"
                        role="listbox"
                        aria-label="Host suggestions"
                      >
                        {suggestions.map((s) => (
                          <li key={s.wallet}>
                            <button
                              type="button"
                              role="option"
                              className="flex w-full min-h-[40px] flex-col items-start gap-0.5 px-3 py-2 text-left touch-manipulation hover:bg-muted/50"
                              onClick={() => applyHost(s)}
                            >
                              <span className="font-medium text-foreground">{s.label}</span>
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {s.wallet}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {hostMessage ? (
                      <p className="text-xs text-muted-foreground" role="status">
                        {hostMessage}
                      </p>
                    ) : null}
                    {ambiguousHosts && ambiguousHosts.length > 0 ? (
                      <ul
                        className="max-h-48 overflow-y-auto rounded-lg border border-amber-500/30 bg-background py-1 text-sm"
                        role="listbox"
                        aria-label="Choose host"
                      >
                        {ambiguousHosts.map((h) => (
                          <li key={h.wallet}>
                            <button
                              type="button"
                              role="option"
                              className="flex w-full min-h-[40px] flex-col items-start gap-0.5 px-3 py-2 text-left touch-manipulation hover:bg-muted/50"
                              onClick={() => applyHost(h)}
                            >
                              <span className="font-medium text-foreground">{h.label}</span>
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {h.wallet}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : null}

          {showCollectionFilter ? (
            <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
              <span className="shrink-0 pt-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-14">
                Project
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                {hasCollection ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-green-500/40 bg-background px-3 py-2 text-sm font-medium shadow-sm ring-1 ring-green-500/20">
                      <span className="truncate">Project: {collectionLabel?.trim() || collectionMint}</span>
                      <button
                        type="button"
                        onClick={() => {
                          onCollectionChange?.(null, null)
                          clearCollectionUi()
                        }}
                        className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded-md text-muted-foreground hover:text-foreground touch-manipulation"
                        aria-label="Clear project filter"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <label htmlFor={collectionId} className="sr-only">
                        Filter by project or collection mint
                      </label>
                      <Input
                        ref={collectionInputRef}
                        id={collectionId}
                        type="search"
                        enterKeyHint="search"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="Collection name or mint"
                        value={collectionDraft}
                        onChange={(e) => {
                          setCollectionDraft(e.target.value)
                          setCollectionMessage(null)
                          setAmbiguousCollections(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            submitCollectionDraft()
                          }
                        }}
                        className="min-h-[44px] touch-manipulation text-base sm:text-sm"
                      />
                      <button
                        type="button"
                        onClick={submitCollectionDraft}
                        className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium touch-manipulation hover:bg-muted/60"
                      >
                        Apply
                      </button>
                    </div>
                    {collectionSuggestions.length > 0 ? (
                      <ul
                        className="max-h-40 overflow-y-auto rounded-lg border border-border/70 bg-background py-1 text-sm shadow-sm"
                        role="listbox"
                        aria-label="Project suggestions"
                      >
                        {collectionSuggestions.map((s) => (
                          <li key={s.mint}>
                            <button
                              type="button"
                              role="option"
                              className="flex w-full min-h-[40px] flex-col items-start gap-0.5 px-3 py-2 text-left touch-manipulation hover:bg-muted/50"
                              onClick={() => applyCollection(s)}
                            >
                              <span className="font-medium text-foreground">{s.label}</span>
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {s.mint}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {collectionMessage ? (
                      <p className="text-xs text-muted-foreground" role="status">
                        {collectionMessage}
                      </p>
                    ) : null}
                    {ambiguousCollections && ambiguousCollections.length > 0 ? (
                      <ul
                        className="max-h-48 overflow-y-auto rounded-lg border border-amber-500/30 bg-background py-1 text-sm"
                        role="listbox"
                        aria-label="Choose project"
                      >
                        {ambiguousCollections.map((c) => (
                          <li key={c.mint}>
                            <button
                              type="button"
                              role="option"
                              className="flex w-full min-h-[40px] flex-col items-start gap-0.5 px-3 py-2 text-left touch-manipulation hover:bg-muted/50"
                              onClick={() => applyCollection(c)}
                            >
                              <span className="font-medium text-foreground">{c.label}</span>
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {c.mint}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : null}
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
