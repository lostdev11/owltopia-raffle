'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, Loader2, ShoppingCart } from 'lucide-react'
import { CartCheckoutPanel } from '@/components/cart/CartCheckoutPanel'
import { CartBrowseRaffles } from '@/components/cart/CartBrowseRaffles'
import { useCart } from '@/components/cart/CartProvider'
import { getCachedAdmin, setCachedAdmin, type AdminRole } from '@/lib/admin-check-cache'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'

export function CartPageClient() {
  const { publicKey, connected } = useWallet()
  const visibilityTick = useVisibilityTick()
  const wallet = publicKey?.toBase58() ?? ''
  const [viewerIsAdmin, setViewerIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdmin(wallet) : null
  )

  useEffect(() => {
    if (!connected || !publicKey) {
      setViewerIsAdmin(false)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached !== null) {
      setViewerIsAdmin(cached)
      return
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role: AdminRole | null = admin && data?.role === 'full' ? 'full' : null
        setCachedAdmin(addr, admin, role)
        setViewerIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setViewerIsAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, visibilityTick])

  const { lines, ticketCount } = useCart()
  const currencyLabel = lines[0]?.snapshot.currency ?? ''
  const intro =
    lines.length >= 2
      ? `One wallet approval pays for all ${lines.length} raffles in one batch transaction. Each line keeps its own ticket count — raffle pages and sold totals update per raffle. On slow mobile data or Wi‑Fi, wait for confirmation before leaving.`
      : 'Add multiple live raffles, then check out. Two or more raffles in the same currency use a single on-chain payment when available.'

  if (!connected) {
    return (
      <div className="container mx-auto px-3 sm:px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-w-6xl">
        <Link
          href="/raffles"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground min-h-[44px] py-2 touch-manipulation"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          All raffles
        </Link>
        <div className="mt-8 rounded-xl border border-border bg-card/50 p-6 max-w-md">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-green-500 shrink-0" aria-hidden />
            Cart
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Connect your wallet to open the cart. This checkout flow is temporarily limited to admins while we finish testing.
          </p>
        </div>
      </div>
    )
  }

  if (viewerIsAdmin === null) {
    return (
      <div className="container mx-auto px-3 sm:px-4 py-16 flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
        <p className="text-sm">Checking access…</p>
      </div>
    )
  }

  if (!viewerIsAdmin) {
    return (
      <div className="container mx-auto px-3 sm:px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-w-6xl">
        <Link
          href="/raffles"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground min-h-[44px] py-2 touch-manipulation"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          All raffles
        </Link>
        <div className="mt-8 rounded-xl border border-border bg-card/50 p-6 max-w-lg">
          <h1 className="text-xl font-semibold">Cart unavailable</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The multi-raffle cart is temporarily visible only to site admins while we verify batch checkout. You can still enter each raffle from its page with Buy tickets.
          </p>
        </div>
      </div>
    )
  }

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
