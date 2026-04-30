'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import type { Raffle } from '@/lib/types'
import { raffleCheckoutBlockedReason } from '@/lib/cart/validate-raffle-checkout'
import { MAX_TICKET_QUANTITY_PER_ENTRY } from '@/lib/entries/max-ticket-quantity'
import { useCart } from '@/components/cart/CartProvider'

function sortPurchasable(a: Raffle, b: Raffle): number {
  const endA = new Date(a.end_time).getTime()
  const endB = new Date(b.end_time).getTime()
  if (Number.isFinite(endA) && Number.isFinite(endB) && endA !== endB) return endA - endB
  return String(a.title).localeCompare(String(b.title))
}

export function CartBrowseRaffles() {
  const { lines, addItem } = useCart()
  const [list, setList] = useState<Raffle[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [flashError, setFlashError] = useState<string | null>(null)

  const cartCurrency = lines[0]?.snapshot.currency ?? null

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/raffles?active=true', { credentials: 'include' })
        if (!res.ok) {
          setLoadError('Could not load raffles. Try again in a moment.')
          setList([])
          return
        }
        const data = (await res.json()) as Raffle[]
        if (cancelled) return
        setList(Array.isArray(data) ? data : [])
        setLoadError(null)
      } catch {
        if (!cancelled) {
          setLoadError('Network error loading raffles.')
          setList([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const purchasable = useMemo(() => {
    if (!list) return []
    const rows: Raffle[] = []
    for (const r of list) {
      if (raffleCheckoutBlockedReason(r)) continue
      if (cartCurrency && String(r.currency || 'SOL') !== String(cartCurrency)) continue
      rows.push(r)
    }
    rows.sort(sortPurchasable)
    return rows
  }, [list, cartCurrency])

  const getQty = useCallback(
    (id: string) => {
      const q = quantities[id]
      if (typeof q === 'number' && q >= 1) return Math.min(MAX_TICKET_QUANTITY_PER_ENTRY, q)
      return 1
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
    return <p className="text-sm text-destructive py-4">{loadError}</p>
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
              className="rounded-lg border border-border bg-muted/20 p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between touch-manipulation"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <Link
                  href={`/raffles/${encodeURIComponent(raffle.slug)}`}
                  className="font-medium text-sm hover:underline break-words line-clamp-2"
                >
                  {raffle.title}
                </Link>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
                  min={1}
                  max={MAX_TICKET_QUANTITY_PER_ENTRY}
                  inputMode="numeric"
                  className="w-20 h-11 text-base"
                  value={quantities[raffle.id] ?? 1}
                  onChange={e => {
                    const n = Math.min(
                      MAX_TICKET_QUANTITY_PER_ENTRY,
                      Math.max(1, Math.floor(Number(e.target.value) || 1))
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
            </li>
          )
        })}
      </ul>
    </div>
  )
}
