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
import {
  buildPurchaseTransactionFromPaymentDetails,
  executeRafflePurchase,
  type PurchasePaymentDetails,
} from '@/lib/client/execute-raffle-purchase'
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
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import { parseVerifyBatchFailure, verifyBatchFailureUserMessage } from '@/lib/api/verify-batch-response'

type CartContextValue = {
  lines: CartLine[]
  lineCount: number
  ticketCount: number
  checkoutBusy: boolean
  checkoutError: string | null
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
    if (!raffleId || !Number.isFinite(quantity) || quantity < 1 || !snapshot?.title || !snapshot?.slug) {
      continue
    }
    const q = Math.min(MAX_TICKET_QUANTITY_PER_ENTRY, Math.max(1, quantity))
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retries verification when the server RPC, rate limits, or indexer lag flaps.
 * Response JSON includes a stable `code` for user-facing copy (see verify-batch-response).
 */
async function fetchVerifyBatchWithRetries(entryIds: string[], transactionSignature: string): Promise<Response> {
  const backoffMs = [0, 900, 2400, 5200]
  let last!: Response
  for (let i = 0; i < backoffMs.length; i++) {
    if (backoffMs[i] > 0) await sleep(backoffMs[i])
    last = await fetch('/api/entries/verify-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ entryIds, transactionSignature }),
    })
    if (last.ok || last.status === 202) return last
    const moreAttempts = i < backoffMs.length - 1
    if (
      moreAttempts &&
      (last.status === 429 || last.status >= 500 || last.status === 400)
    ) {
      continue
    }
    return last
  }
  return last
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [batchReceipt, setBatchReceipt] = useState<CartBatchReceiptState | null>(null)
  const router = useRouter()
  const { connection } = useConnection()
  const { publicKey, connected } = useWallet()
  const sendTransaction = useSendTransactionForWallet()

  useEffect(() => {
    setLines(loadCartLines())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    persistLines(lines)
  }, [hydrated, lines])

  const linesRef = useRef(lines)
  linesRef.current = lines

  /** Prevents overlapping checkout (double tap / duplicate requests) while batch tx + verify run. */
  const checkoutRunLockRef = useRef(false)

  const lineCount = lines.length
  const ticketCount = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines])

  const clearCart = useCallback(() => setLines([]), [])

  const removeLine = useCallback((raffleId: string) => {
    setLines(prev => prev.filter(l => l.raffleId !== raffleId))
  }, [])

  const setLineQuantity = useCallback((raffleId: string, quantity: number) => {
    const q = Math.min(MAX_TICKET_QUANTITY_PER_ENTRY, Math.max(1, Math.floor(quantity)))
    setLines(prev => {
      const next = prev.map(l => (l.raffleId === raffleId ? { ...l, quantity: q } : l))
      return next.some(l => l.raffleId === raffleId) ? next : prev
    })
  }, [])

  const addItem = useCallback(
    (raffle: Raffle, quantity: number) => {
      const q = Math.min(MAX_TICKET_QUANTITY_PER_ENTRY, Math.max(1, Math.floor(quantity)))
      const block = raffleCheckoutBlockedReason(raffle)
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
        return [...prev, { raffleId: raffle.id, quantity: q, addedAt: Date.now(), snapshot: snap }]
      })

      if (conflict) return { ok: false as const, error: conflict }
      return { ok: true as const }
    },
    [setLines]
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
    setBatchReceipt(null)

    const initialSnapshot = [...linesRef.current]

    try {
      type Loaded = { line: CartLine; fresh: Raffle }
      const loaded: Loaded[] = []

      for (const line of initialSnapshot) {
        let fresh: Raffle
        try {
          const raffleRes = await fetch(`/api/raffles/${line.raffleId}`)
          if (!raffleRes.ok) {
            setCheckoutError('One raffle in your cart could not be loaded. It may have been removed.')
            setLines(initialSnapshot)
            return
          }
          fresh = (await raffleRes.json()) as Raffle
        } catch {
          setCheckoutError('Network error loading raffle details. Try again.')
          setLines(initialSnapshot)
          return
        }

        const block = raffleCheckoutBlockedReason(fresh)
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
        let createResponse: Response
        try {
          createResponse = await fetch('/api/entries/create-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              walletAddress: publicKey.toBase58(),
              items: loaded.map(({ line }) => ({
                raffleId: line.raffleId,
                ticketQuantity: line.quantity,
              })),
            }),
          })
        } catch {
          setCheckoutError('Network error preparing batch checkout.')
          setLines(initialSnapshot)
          return
        }

        if (!createResponse.ok) {
          let msg = 'Batch checkout unavailable. Try again or pay one raffle at a time.'
          try {
            const ct = createResponse.headers.get('content-type') || ''
            if (ct.includes('application/json')) {
              const errData = (await createResponse.json()) as { error?: string }
              if (typeof errData?.error === 'string') msg = errData.error
            }
          } catch {
            /* ignore */
          }
          setCheckoutError(msg)
          setLines(initialSnapshot)
          return
        }

        let batchPayload: {
          entryIds?: string[]
          paymentDetails?: PurchasePaymentDetails
        }
        try {
          batchPayload = await createResponse.json()
        } catch {
          setCheckoutError('Invalid response from checkout server.')
          setLines(initialSnapshot)
          return
        }

        const entryIds = batchPayload.entryIds
        const pd = batchPayload.paymentDetails
        if (!entryIds?.length || !pd) {
          setCheckoutError('Invalid batch checkout payload.')
          setLines(initialSnapshot)
          return
        }

        let signature: string
        try {
          const transaction = await buildPurchaseTransactionFromPaymentDetails(
            connection,
            publicKey,
            String(pd.currency || loaded[0]!.fresh.currency || 'SOL'),
            pd
          )
          signature = await sendTransaction(transaction, connection, {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 3,
          })
        } catch (err: unknown) {
          const wm = err instanceof Error ? err.message : String(err)
          if (/rejected|cancell?ed/i.test(wm)) {
            setCheckoutError('Transaction was cancelled.')
          } else {
            setCheckoutError(wm.includes('Insufficient') ? wm : `Payment failed: ${wm}`)
          }
          setLines(initialSnapshot)
          return
        }

        try {
          await confirmSignatureSuccessOnChain(connection, signature)
        } catch (confirmErr: unknown) {
          const wm = confirmErr instanceof Error ? confirmErr.message : String(confirmErr)
          if (wm.toLowerCase().includes('transaction failed')) {
            setCheckoutError('On-chain transaction failed.')
          } else {
            setCheckoutError(
              'Transaction confirmation timed out. You can retry verify from your orders if payment went through.'
            )
          }
          setLines(initialSnapshot)
          router.refresh()
          return
        }

        const receiptLines = loaded.map(({ line }) => ({
          raffleId: line.raffleId,
          title: line.snapshot.title,
          slug: line.snapshot.slug,
          quantity: line.quantity,
          image_url: line.snapshot.image_url,
          image_fallback_url: line.snapshot.image_fallback_url,
        }))
        setBatchReceipt({ lines: receiptLines, phase: 'verifying' })

        let verifyRes: Response
        try {
          verifyRes = await fetchVerifyBatchWithRetries(entryIds, signature)
        } catch {
          setBatchReceipt(prev => (prev ? { ...prev, phase: 'failed' } : null))
          setCheckoutError('Network error confirming tickets. Your cart was restored.')
          setLines(initialSnapshot)
          router.refresh()
          return
        }

        if (verifyRes.status === 202) {
          setBatchReceipt(prev => (prev ? { ...prev, phase: 'pending_async' } : null))
          requestAnimationFrame(() => fireGreenConfetti())
          setLines([])
          router.refresh()
          return
        }

        if (!verifyRes.ok) {
          setBatchReceipt(prev => (prev ? { ...prev, phase: 'failed' } : null))
          const { status, code } = await parseVerifyBatchFailure(verifyRes)
          setCheckoutError(verifyBatchFailureUserMessage(status, code))
          setLines(initialSnapshot)
          router.refresh()
          return
        }

        setBatchReceipt(prev => (prev ? { ...prev, phase: 'success' } : null))
        requestAnimationFrame(() => fireGreenConfetti())
        setLines([])
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
          setCheckoutError(msg)
          if (result.isUnconfirmedPayment) router.refresh()
          setLines(remaining)
          return
        }

        remaining = remaining.slice(1)
        setLines([...remaining])
      }

      router.refresh()
    } finally {
      checkoutRunLockRef.current = false
      setCheckoutBusy(false)
    }
  }, [connected, publicKey, connection, sendTransaction, router])

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      lineCount,
      ticketCount,
      checkoutBusy,
      checkoutError,
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
