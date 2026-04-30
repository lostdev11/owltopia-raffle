'use client'

import Link from 'next/link'
import { ArrowLeft, ShoppingCart } from 'lucide-react'
import { CartCheckoutPanel } from '@/components/cart/CartCheckoutPanel'
import { CartBrowseRaffles } from '@/components/cart/CartBrowseRaffles'
import { useCart } from '@/components/cart/CartProvider'

export function CartPageClient() {
  const { lines, ticketCount } = useCart()
  const currencyLabel = lines[0]?.snapshot.currency ?? ''
  const intro =
    lines.length >= 2
      ? `One wallet approval pays for all ${lines.length} raffles in one batch transaction. Each line keeps its own ticket count — raffle pages and sold totals update per raffle. On slow mobile data or Wi‑Fi, wait for confirmation before leaving.`
      : 'Add multiple live raffles, then check out. Two or more raffles in the same currency use a single on-chain payment when available.'

  return (
    <div className="container mx-auto px-3 sm:px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-w-6xl">
      <div className="mb-6 space-y-3">
        <Link
          href="/raffles"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground min-h-[44px] py-2 touch-manipulation"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          All raffles
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <ShoppingCart className="h-8 w-8 shrink-0 text-green-500" aria-hidden />
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Cart</h1>
            {ticketCount > 0 ? (
              <p className="text-sm text-muted-foreground">
                {ticketCount} ticket{ticketCount === 1 ? '' : 's'}
                {currencyLabel ? ` · ${currencyLabel}` : ''}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Select raffles and ticket counts, then checkout.</p>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">{intro}</p>
        {lines.length > 1 && currencyLabel ? (
          <p className="text-sm text-muted-foreground">All items use {currencyLabel}.</p>
        ) : null}
      </div>

      <div className="grid gap-8 lg:grid-cols-5 lg:gap-10 lg:items-start">
        <section
          className="lg:col-span-2 rounded-xl border border-green-500/20 bg-card/50 p-4 sm:p-5 flex flex-col min-h-[min(50vh,420px)] max-h-[min(70vh,560px)] lg:max-h-[min(80vh,720px)] touch-manipulation"
          aria-labelledby="cart-your-tickets"
        >
          <h2 id="cart-your-tickets" className="text-lg font-semibold mb-3 shrink-0">
            Your tickets
          </h2>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <CartCheckoutPanel />
          </div>
        </section>

        <section className="lg:col-span-3 space-y-4" aria-labelledby="cart-add-raffles">
          <h2 id="cart-add-raffles" className="text-lg font-semibold">
            Add live raffles
          </h2>
          <p className="text-sm text-muted-foreground">
            Ending-soon raffles appear first. If your cart already has tickets, only raffles in the same currency are listed.
          </p>
          <CartBrowseRaffles />
        </section>
      </div>
    </div>
  )
}
