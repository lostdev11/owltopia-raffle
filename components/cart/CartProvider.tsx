'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import type { Raffle } from '@/lib/types'
import { executeRafflePurchase } from '@/lib/client/execute-raffle-purchase'
import { executeCartBatchCheckout } from '@/lib/client/execute-cart-checkout'
import { fetchWithTimeout } from '@/lib/client/fetch-with-timeout'
import { resumePendingVerifications } from '@/lib/client/pending-verification'
import { fireGreenConfetti } from '@/lib/confetti'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import type { CartLine } from '@/lib/cart/types'
import { CART_STORAGE_KEY } from '@/lib/cart/types'
import { raffleCheckoutBlockedReason } from '@/lib/cart/validate-raffle-checkout'
import {
  CartBatchVerifyDialog,
  type CartBatchReceiptState,
} from '@/components/cart/CartBatchVerifyDialog'
import { MAX_TICKET_QUANTITY_PER_ENTRY } from '@/lib/entries/max-ticket-quantity'
import {
  computeCartLinesAfterBatchCheckout,
  PAID_UNVERIFIED_CART_NOTE,
} from '@/lib/cart/checkout-restore'
import { dispatchPurchaseCompleted } from '@/lib/cart/purchase-complete-events'
import { CART_CHECKOUT_MAX_RAFFLES } from '@/lib/cart/constants'

type CartContextValue = {
  lines: CartLine[]
  lineCount: number
  ticketCount: number
  checkoutBusy: boolean
  checkoutError: string | null
  checkoutBatchProgress: { current: number; total: number } | null
  checkout: () => Promise<void>
  addItem: (raffle: Raffle, quantity: number) => { ok: true } | { ok: false; error: string }
  removeLine: (raffleId: string) => void
  setLineQuantity: (raffleId: string, quantity: number) => void
  clearCart: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

function loadCartLines(): CartLine[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as CartStateLike).lines)) {
      return []
    }
    return sanitizeLines((parsed as CartStateLike).lines as unknown[])
  } catch {
    return []
  }
}

type CartStateLike = { lines: unknown }

function sanitizeLines(raw: unknown[]): CartLine[] {
  const lines: CartLine[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const raffleId = typeof o.raffleId === 'string' ? o.raffleId : null
    const quantity = typeof o.quantity === 'number' ? Math.floor(o.quantity) : NaN
    const addedAt =
      typeof o.addedAt === 'number'
        ? o.addedAt
        : typeof o.addedAt === 'string'
          ? Number(o.addedAt)
          : Date.now()
    const snapshot = o.snapshot && typeof o.snapshot === 'object' ? (o.snapshot as CartLine['snapshot']) : null
    if (!raffleId || !Number.isFinite(quantity) || quantity < 0 || !snapshot?.title || !snapshot?.slug) {
      continue
    }
    const q = Math.min(MAX_TICKET_QUANTITY_PER_ENTRY, Math.max(0, Math.floor(quantity)))
    const snap: CartLine['snapshot'] = {
      title: String(snapshot.title),
      slug: String(snapshot.slug),
      currency: (snapshot.currency as CartLine['snapshot']['currency']) || 'SOL',
      ticket_price: Number(snapshot.ticket_price) || 0,
    }
    if (typeof snapshot.image_url === 'string') snap.image_url = snapshot.image_url
    else if (snapshot.image_url === null) snap.image_url = null
    if (typeof snapshot.image_fallback_url === 'string') snap.image_fallback_url = snapshot.image_fallback_url
    else if (snapshot.image_fallback_url === null) snap.image_fallback_url = null

    lines.push({
      raffleId,
      quantity: q,
      addedAt: Number.isFinite(addedAt) ? addedAt : Date.now(),
      snapshot: snap,
    })
  }
  return lines
}

function persistLines(lines: CartLine[]) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ lines }))
  } catch {
    /* ignore quota */
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutBatchProgress, setCheckoutBatchProgress] = useState<{ current: number; total: number } | null>(
    null
  )
  const [batchReceipt, setBatchReceipt] = useState<CartBatchReceiptState | null>(null)
  const router = useRouter()
  const { connection } = useConnection()
  const { publicKey, connected } = useWallet()
  const sendTransaction = useSendTransactionForWallet()

  useEffect(() => {
    setLines(loadCartLines())
    setHydrated(true)
  }, [])

  /**
   * Recover purchases whose tab died between wallet send and verify (mobile wallet
   * redirect / backgrounding): re-run verify for stored signatures on mount, on tab
   * foreground, and on bfcache restore. No-op when nothing is stored (desktop unchanged).
   */
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = () => {
      if (timer) clearTimeout(timer)
      // Short delay so the wallet/in-app browser network stabilizes after return (see MOBILE_FIRST).
      timer = setTimeout(() => {
        void resumePendingVerifications({
          onConfirmed: () => {
            if (!disposed) router.refresh()
          },
        })
      }, 600)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') run()
    }
    run()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', run)
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', run)
    }
  }, [router])

  useEffect(() => {
    if (!hydrated) return
    persistLines(lines)
  }, [hydrated, lines])

  const linesRef = useRef(lines)
  linesRef.current = lines

  /** Prevents overlapping checkout (double tap / duplicate requests) while batch tx + verify run. */
  const checkoutRunLockRef = useRef(false)

  /**
   * Cross-tab sync: reload cart when another tab (e.g. a wallet in-app browser
   * alongside the regular browser) writes it. `storage` only fires in other tabs,
   * so this cannot loop with the persist effect above.
   */
  useEffect(() => {
    if (!hydrated) return
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== CART_STORAGE_KEY) return
      // Don't clobber an in-flight checkout's view of the cart; its final
      // setLines persists and wins (last-writer semantics).
      if (checkoutRunLockRef.current) return
      setLines(loadCartLines())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [hydrated])

  const lineCount = lines.length
  const ticketCount = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines])

  const clearCart = useCallback(() => setLines([]), [])

  const removeLine = useCallback((raffleId: string) => {
    setLines(prev => prev.filter(l => l.raffleId !== raffleId))
  }, [])

  const setLineQuantity = useCallback((raffleId: string, quantity: number) => {
    const q = Math.min(MAX_TICKET_QUANTITY_PER_ENTRY, Math.max(0, Math.floor(quantity)))
    setLines(prev => {
      const next = prev.map(l => (l.raffleId === raffleId ? { ...l, quantity: q } : l))
      return next.some(l => l.raffleId === raffleId) ? next : prev
    })
  }, [])

  const addItem = useCallback(
    (raffle: Raffle, quantity: number) => {
      const q = Math.min(MAX_TICKET_QUANTITY_PER_ENTRY, Math.max(0, Math.floor(quantity)))
      const block = raffleCheckoutBlockedReason(raffle, publicKey?.toBase58())
      if (block) return { ok: false as const, error: block }

      let conflict: string | undefined
      const snap = {
        title: raffle.title,
        slug: raffle.slug,
        currency: raffle.currency,
        ticket_price: Number(raffle.ticket_price),
        image_url: raffle.image_url,
        image_fallback_url: raffle.image_fallback_url,
      }

      setLines(prev => {
        if (prev.length > 0 && String(prev[0].snapshot.currency) !== String(raffle.currency)) {
          conflict =
            'Your cart can only hold raffles paid in the same currency. Clear the cart or finish checkout first.'
          return prev
        }
        const idx = prev.findIndex(l => l.raffleId === raffle.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = {
            ...next[idx],
            quantity: Math.min(MAX_TICKET_QUANTITY_PER_ENTRY, next[idx].quantity + q),
            snapshot: snap,
          }
          return next
        }
        if (prev.length >= CART_CHECKOUT_MAX_RAFFLES) {
          conflict = `Cart checkout supports up to ${CART_CHECKOUT_MAX_RAFFLES} raffles at once. Please checkout this cart first, then continue with the rest.`
          return prev
        }
        return [...prev, { raffleId: raffle.id, quantity: q, addedAt: Date.now(), snapshot: snap }]
      })

      if (conflict) return { ok: false as const, error: conflict }
      return { ok: true as const }
    },
    [setLines, publicKey]
  )

  const checkout = useCallback(async () => {
    if (!connected || !publicKey) {
      setCheckoutError('Connect your wallet to checkout.')
      return
    }
    if (linesRef.current.length === 0) return
    if (checkoutRunLockRef.current) return
    checkoutRunLockRef.current = true

    setCheckoutBusy(true)
    setCheckoutError(null)
    setCheckoutBatchProgress(null)
    setBatchReceipt(null)

    const initialSnapshot = [...linesRef.current]
    if (initialSnapshot.length > CART_CHECKOUT_MAX_RAFFLES) {
      setCheckoutError(
        `This cart has ${initialSnapshot.length} raffles, but checkout supports up to ${CART_CHECKOUT_MAX_RAFFLES} at once. Split it into smaller checkouts.`
      )
      setCheckoutBusy(false)
      checkoutRunLockRef.current = false
      return
    }

    if (initialSnapshot.some(l => l.quantity < 1)) {
      setCheckoutError('Enter at least one ticket for each raffle before checkout.')
      setCheckoutBusy(false)
      checkoutRunLockRef.current = false
      return
    }

    try {
      type Loaded = { line: CartLine; fresh: Raffle }
      const loaded: Loaded[] = []

      for (const line of initialSnapshot) {
        let fresh: Raffle
        try {
          const raffleRes = await fetchWithTimeout(`/api/raffles/${line.raffleId}`)
          if (!raffleRes.ok) {
            setCheckoutError('One raffle in your cart could not be loaded. It may have been removed.')
            setLines(initialSnapshot)
            return
          }
          fresh = (await raffleRes.json()) as Raffle
        } catch {
          setCheckoutError(
            'Network error loading raffle details. Check your connection (WiFi or mobile data) and try again.'
          )
          setLines(initialSnapshot)
          return
        }

        const block = raffleCheckoutBlockedReason(fresh, publicKey.toBase58())
        if (block) {
          setCheckoutError(`${fresh.title}: ${block}`)
          setLines(initialSnapshot)
          return
        }

        const snapCur = String(line.snapshot.currency || 'SOL')
        if (String(fresh.currency || 'SOL') !== snapCur) {
          setCheckoutError('Cart currency no longer matches this raffle — refresh or remove stale items.')
          setLines(initialSnapshot)
          return
        }

        loaded.push({ line, fresh })
      }

      /**
       * Paid batch path: merged payouts = one Solana signature (multi-raffle or multi-qty).
       * Single raffle + qty 1 uses execute flow so the server may return referral complimentary checkout.
       */
      const complimentarySingleTicketEligible =
        loaded.length === 1 && loaded[0]!.line.quantity === 1
      const usePaidBatchCheckout = loaded.length >= 2 || !complimentarySingleTicketEligible

      if (usePaidBatchCheckout) {
        const allReceiptLines = loaded.map(({ line }) => ({
          raffleId: line.raffleId,
          title: line.snapshot.title,
          slug: line.snapshot.slug,
          quantity: line.quantity,
          image_url: line.snapshot.image_url,
          image_fallback_url: line.snapshot.image_fallback_url,
        }))
        setBatchReceipt({ lines: allReceiptLines, phase: 'verifying' })

        const result = await executeCartBatchCheckout({
          loaded,
          publicKey,
          connection,
          sendTransaction,
          onBatchProgress: (current, total) => setCheckoutBatchProgress({ current, total }),
          onReceiptPhase: phase => setBatchReceipt(prev => (prev ? { ...prev, phase } : null)),
        })

        // Settled lines are done; paid-but-unverified lines must not come back
        // (double-payment risk) — the pending-verification resume recovers them.
        setLines(
          computeCartLinesAfterBatchCheckout(
            initialSnapshot,
            result.settledRaffleIds,
            result.paidUnverifiedRaffleIds
          )
        )

        if (!result.ok) {
          setCheckoutError(result.error)
          if (result.refresh) router.refresh()
          return
        }

        requestAnimationFrame(() => fireGreenConfetti())
        dispatchPurchaseCompleted({
          wallet: publicKey.toBase58(),
          raffleIds: result.settledRaffleIds,
        })
        router.refresh()
        return
      }

      let remaining = [...initialSnapshot]
      const initialCount = remaining.length

      while (remaining.length > 0) {
        const line = remaining[0]!
        const isLast = remaining.length === 1

        const { fresh } = loaded.find(l => l.line.raffleId === line.raffleId)!

        const result = await executeRafflePurchase({
          raffle: fresh,
          ticketQuantity: line.quantity,
          publicKey,
          connection,
          sendTransaction,
          routerRefresh: () => router.refresh(),
          celebrateOnComplimentary: true,
          celebrateOnPaymentConfirmed: isLast,
          onComplimentarySuccess: () => router.refresh(),
        })

        if (!result.ok) {
          const msg =
            remaining.length === initialCount && initialCount > 1
              ? `${result.error} (${line.snapshot.title}). Remaining items are still in your cart.`
              : result.error
          if (result.isUnconfirmedPayment) {
            // Payment may be on-chain — keep this line out of the cart so a
            // retry cannot double-pay; pending-verification resume recovers it.
            setCheckoutError(`${msg} ${PAID_UNVERIFIED_CART_NOTE}`)
            setLines(remaining.slice(1))
            router.refresh()
          } else {
            setCheckoutError(msg)
            setLines(remaining)
          }
          return
        }

        remaining = remaining.slice(1)
        setLines([...remaining])
      }

      dispatchPurchaseCompleted({
        wallet: publicKey.toBase58(),
        raffleIds: initialSnapshot.map(l => l.raffleId),
      })
      router.refresh()
    } finally {
      checkoutRunLockRef.current = false
      setCheckoutBusy(false)
      setCheckoutBatchProgress(null)
    }
  }, [connected, publicKey, connection, sendTransaction, router])

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      lineCount,
      ticketCount,
      checkoutBusy,
      checkoutError,
      checkoutBatchProgress,
      checkout,
      addItem,
      removeLine,
      setLineQuantity,
      clearCart,
    }),
    [
      lines,
      lineCount,
      ticketCount,
      checkoutBusy,
      checkoutError,
      checkoutBatchProgress,
      checkout,
      addItem,
      removeLine,
      setLineQuantity,
      clearCart,
    ]
  )

  return (
    <>
      <CartBatchVerifyDialog
        open={batchReceipt !== null}
        receipt={batchReceipt}
        onOpenChange={nextOpen => {
          if (!nextOpen) setBatchReceipt(null)
        }}
      />
      <CartContext.Provider value={value}>{children}</CartContext.Provider>
    </>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
