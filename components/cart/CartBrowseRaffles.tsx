'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCachedAdmin } from '@/lib/admin-check-cache'
import { fetchCartBrowseRaffles } from '@/lib/cart/fetch-cart-browse-raffles'
import { Input } from '@/components/ui/input'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import type { Raffle } from '@/lib/types'
import { raffleCheckoutBlockedReason } from '@/lib/cart/validate-raffle-checkout'
import { MAX_TICKET_QUANTITY_PER_ENTRY } from '@/lib/entries/max-ticket-quantity'
import { useCart } from '@/components/cart/CartProvider'
import { RaffleListThumbnail } from '@/components/RaffleListThumbnail'

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
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [flashError, setFlashError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const cartCurrency = lines[0]?.snapshot.currency ?? null
  const viewerWallet = publicKey?.toBase58() ?? null

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

  const getQty = useCallback(
    (id: string) => {
      const q = quantities[id]
      if (typeof q === 'number' && q >= 0) return Math.min(MAX_TICKET_QUANTITY_PER_ENTRY, q)
      return 0
    },
    [quantities]
  )

  const handleAdd = useCallback(
    (raffle: Raffle) => {
      setFlashError(null)
      const q = getQty(raffle.id)
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
          const inCart = lines.some(l => l.raffleId === raffle.id)
          const price = Number(raffle.ticket_price) || 0
          const cur = (raffle.currency || 'SOL') as 'SOL' | 'USDC' | 'OWL'

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
                  {inCart ? (
                    <span className="text-xs font-medium text-green-600 dark:text-green-400">In cart</span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <label className="sr-only" htmlFor={`browse-q-${raffle.id}`}>
                  Tickets for {raffle.title}
                </label>
                <Input
                  id={`browse-q-${raffle.id}`}
                  type="number"
                  min={0}
                  max={MAX_TICKET_QUANTITY_PER_ENTRY}
                  inputMode="numeric"
                  className="w-20 h-11 text-base"
                  value={quantities[raffle.id] ?? 0}
                  onChange={e => {
                    const n = Math.min(
                      MAX_TICKET_QUANTITY_PER_ENTRY,
                      Math.max(0, Math.floor(Number(e.target.value) || 0))
                    )
                    setQuantities(prev => ({ ...prev, [raffle.id]: n }))
                  }}
                />
                <Button
                  type="button"
                  className="min-h-[44px] touch-manipulation"
                  onClick={() => handleAdd(raffle)}
                >
                  {inCart ? 'Add more' : 'Add to cart'}
                </Button>
              </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
