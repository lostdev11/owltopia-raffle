'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCachedAdmin } from '@/lib/admin-check-cache'
import { fetchCartBrowseRaffles } from '@/lib/cart/fetch-cart-browse-raffles'
import { fetchEntrySummariesByRaffleIdsClient } from '@/lib/raffles/fetch-entry-summaries-client'
import { Input } from '@/components/ui/input'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import type { Raffle } from '@/lib/types'
import { raffleCheckoutBlockedReason } from '@/lib/cart/validate-raffle-checkout'
import { MAX_TICKET_QUANTITY_PER_ENTRY } from '@/lib/entries/max-ticket-quantity'
import { useCart } from '@/components/cart/CartProvider'
import { RaffleListThumbnail } from '@/components/RaffleListThumbnail'

const SUMMARY_CHUNK = 80

function formatTicketCount(n: number, noun = 'ticket'): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`
}

function sortPurchasable(a: Raffle, b: Raffle): number {
  const endA = new Date(a.end_time).getTime()
  const endB = new Date(b.end_time).getTime()
  if (Number.isFinite(endA) && Number.isFinite(endB) && endA !== endB) return endA - endB
  return String(a.title).localeCompare(String(b.title))
}

export function CartBrowseRaffles() {
  const { publicKey } = useWallet()
  const { lines, addItem } = useCart()
  const [list, setList] = useState<Raffle[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** String drafts so users can clear the field (e.g. erase a leading 0) while typing. */
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [flashError, setFlashError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  /** Confirmed tickets already owned by the connected wallet, keyed by raffle id. */
  const [ownedByRaffleId, setOwnedByRaffleId] = useState<Record<string, number>>({})

  const cartCurrency = lines[0]?.snapshot.currency ?? null
  const viewerWallet = publicKey?.toBase58() ?? null
  const cartQtyByRaffleId = useMemo(() => {
    const map: Record<string, number> = {}
    for (const line of lines) {
      map[line.raffleId] = Math.max(0, Math.floor(line.quantity))
    }
    return map
  }, [lines])

  useEffect(() => {
    const ac = new AbortController()
    let cancelled = false
    setList(null)
    setLoadError(null)
    ;(async () => {
      const viewerIsAdmin = viewerWallet ? getCachedAdmin(viewerWallet) === true : false
      try {
        const { raffles, error } = await fetchCartBrowseRaffles({
          viewerWallet,
          viewerIsAdmin,
          signal: ac.signal,
        })
        if (cancelled) return
        setList(raffles)
        setLoadError(error)
      } catch {
        if (!cancelled && !ac.signal.aborted) {
          setLoadError('Network error loading raffles.')
          setList([])
        }
      }
    })()
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [viewerWallet, reloadKey])

  const purchasable = useMemo(() => {
    if (!list) return []
    const rows: Raffle[] = []
    for (const r of list) {
      if (raffleCheckoutBlockedReason(r, viewerWallet)) continue
      if (cartCurrency && String(r.currency || 'SOL') !== String(cartCurrency)) continue
      rows.push(r)
    }
    rows.sort(sortPurchasable)
    return rows
  }, [list, cartCurrency, viewerWallet])

  const purchasableIdsKey = useMemo(() => purchasable.map(r => r.id).join('|'), [purchasable])

  useEffect(() => {
    if (!viewerWallet || !purchasableIdsKey) {
      setOwnedByRaffleId({})
      return
    }
    const ids = purchasableIdsKey.split('|').filter(Boolean)
    const ac = new AbortController()
    let cancelled = false
    ;(async () => {
      const next: Record<string, number> = {}
      for (let i = 0; i < ids.length; i += SUMMARY_CHUNK) {
        const chunk = ids.slice(i, i + SUMMARY_CHUNK)
        const summaries = await fetchEntrySummariesByRaffleIdsClient(chunk, viewerWallet, ac.signal)
        if (cancelled || ac.signal.aborted) return
        for (const id of chunk) {
          const n = Math.max(0, Math.floor(summaries.get(id)?.viewerConfirmedTickets ?? 0))
          if (n > 0) next[id] = n
        }
      }
      if (!cancelled) setOwnedByRaffleId(next)
    })()
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [viewerWallet, purchasableIdsKey])

  const getQty = useCallback(
    (id: string) => {
      const raw = quantities[id]
      if (raw === undefined || raw === '') return 0
      const n = Math.floor(Number(raw))
      if (!Number.isFinite(n) || n < 0) return 0
      return Math.min(MAX_TICKET_QUANTITY_PER_ENTRY, n)
    },
    [quantities]
  )

  const handleAdd = useCallback(
    (raffle: Raffle) => {
      setFlashError(null)
      const q = getQty(raffle.id)
      if (q < 1) {
        setFlashError('Enter at least 1 ticket before adding.')
        return
      }
      const result = addItem(raffle, q)
      if (!result.ok) setFlashError(result.error)
    },
    [addItem, getQty]
  )

  if (list === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden />
        Loading live raffles…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="py-4 space-y-3">
        <p className="text-sm text-destructive">{loadError}</p>
        <p className="text-sm text-muted-foreground">
          You can still check out tickets already in your cart, or browse{' '}
          <Link href="/raffles" className="text-primary underline-offset-2 hover:underline">
            all raffles
          </Link>
          .
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px] touch-manipulation"
          onClick={() => setReloadKey(k => k + 1)}
        >
          Try again
        </Button>
      </div>
    )
  }

  if (purchasable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        {cartCurrency
          ? `No other live raffles in ${cartCurrency} right now. Clear the cart to browse other currencies, or check back soon.`
          : 'No live raffles available to add at the moment.'}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {flashError ? (
        <p className="text-sm text-destructive" role="alert">
          {flashError}
        </p>
      ) : null}
      <ul className="space-y-2">
        {purchasable.map(raffle => {
          const cartQty = cartQtyByRaffleId[raffle.id] ?? 0
          const ownedQty = ownedByRaffleId[raffle.id] ?? 0
          const inCart = cartQty > 0
          const price = Number(raffle.ticket_price) || 0
          const cur = (raffle.currency || 'SOL') as 'SOL' | 'USDC' | 'OWL'
          const holdingParts: string[] = []
          if (ownedQty > 0) holdingParts.push(`You have ${formatTicketCount(ownedQty)}`)
          if (cartQty > 0) holdingParts.push(`${formatTicketCount(cartQty)} in cart`)
          const holdingLabel = holdingParts.join(' · ')

          return (
            <li
              key={raffle.id}
              className="rounded-lg border border-border bg-muted/20 p-3 flex flex-row gap-3 touch-manipulation"
            >
              <Link
                href={`/raffles/${encodeURIComponent(raffle.slug)}`}
                className="shrink-0 self-start sm:self-center rounded-md outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring touch-manipulation"
                aria-label={`View raffle: ${raffle.title}`}
              >
                <RaffleListThumbnail raffle={raffle} size="md" className="rounded-md" />
              </Link>
              <div className="min-w-0 flex-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1 space-y-1">
                <Link
                  href={`/raffles/${encodeURIComponent(raffle.slug)}`}
                  className="font-medium text-sm hover:underline break-words line-clamp-2"
                >
                  {raffle.title}
                </Link>
                <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                  <span>
                    {price.toLocaleString(undefined, { maximumFractionDigits: 12 })}{' '}
                    <CurrencyIcon currency={cur} size={14} />
                  </span>
                  <span className="text-xs">per ticket</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <label className="sr-only" htmlFor={`browse-q-${raffle.id}`}>
                  Tickets for {raffle.title}
                </label>
                <Input
                  id={`browse-q-${raffle.id}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-20 h-11 text-base touch-manipulation"
                  value={quantities[raffle.id] ?? '0'}
                  onChange={e => {
                    const raw = e.target.value
                    if (raw !== '' && !/^\d*$/.test(raw)) return
                    if (raw !== '') {
                      const n = Number(raw)
                      if (Number.isFinite(n) && n > MAX_TICKET_QUANTITY_PER_ENTRY) {
                        setQuantities(prev => ({
                          ...prev,
                          [raffle.id]: String(MAX_TICKET_QUANTITY_PER_ENTRY),
                        }))
                        return
                      }
                    }
                    setQuantities(prev => ({ ...prev, [raffle.id]: raw }))
                  }}
                  onBlur={() => {
                    const raw = quantities[raffle.id]
                    if (raw === undefined) return
                    if (raw === '') {
                      setQuantities(prev => ({ ...prev, [raffle.id]: '0' }))
                      return
                    }
                    const n = Math.floor(Number(raw))
                    if (!Number.isFinite(n) || n < 0) {
                      setQuantities(prev => ({ ...prev, [raffle.id]: '0' }))
                      return
                    }
                    setQuantities(prev => ({
                      ...prev,
                      [raffle.id]: String(Math.min(MAX_TICKET_QUANTITY_PER_ENTRY, n)),
                    }))
                  }}
                />
                <Button
                  type="button"
                  className="min-h-[44px] touch-manipulation"
                  onClick={() => handleAdd(raffle)}
                >
                  {inCart ? 'Add more' : 'Add to cart'}
                </Button>
                {holdingLabel ? (
                  <p
                    className="text-xs font-medium text-green-700 dark:text-green-400 basis-full sm:basis-auto sm:max-w-[11rem] leading-snug"
                    aria-live="polite"
                  >
                    {holdingLabel}
                  </p>
                ) : null}
              </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
