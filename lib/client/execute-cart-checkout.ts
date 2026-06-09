'use client'

import type { SendTransactionOptions } from '@solana/wallet-adapter-base'
import type { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import type { Raffle } from '@/lib/types'
import type { CartLine } from '@/lib/cart/types'
import type { CartBatchReceiptPhase } from '@/components/cart/CartBatchVerifyDialog'
import {
  buildPurchaseTransactionFromPaymentDetails,
  formatSplTokenTransferFailure,
  type PurchasePaymentDetails,
} from '@/lib/client/execute-raffle-purchase'
import { attachPaymentSignaturesBatch } from '@/lib/client/attach-payment-signature'
import {
  recordPendingVerification,
  clearPendingVerification,
} from '@/lib/client/pending-verification'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import { parseVerifyBatchFailure, verifyBatchFailureUserMessage } from '@/lib/api/verify-batch-response'
import { PAID_UNVERIFIED_CART_NOTE } from '@/lib/cart/checkout-restore'
import { fetchWithTimeout } from '@/lib/client/fetch-with-timeout'
import { CART_BATCH_MAX_RAFFLES_PER_TX } from '@/lib/cart/constants'

export type CartCheckoutLoadedLine = { line: CartLine; fresh: Raffle }

export type ExecuteCartBatchCheckoutOptions = {
  loaded: CartCheckoutLoadedLine[]
  publicKey: PublicKey
  connection: Connection
  sendTransaction: (
    tx: Transaction | VersionedTransaction,
    c: Connection,
    opts?: SendTransactionOptions
  ) => Promise<string>
  onBatchProgress: (current: number, total: number) => void
  onReceiptPhase: (phase: CartBatchReceiptPhase) => void
}

export type ExecuteCartBatchCheckoutResult = {
  ok: boolean
  /** User-facing message when ok is false. */
  error: string | null
  /** Verified (or 202 async-pending) raffle IDs — safely out of the cart. */
  settledRaffleIds: string[]
  /**
   * Paid on-chain but verify did not finish — must NOT be restored to the cart
   * (double-payment risk); the pending-verification resume path recovers them.
   */
  paidUnverifiedRaffleIds: string[]
  /** Caller should router.refresh() so server-rendered entry state updates. */
  refresh: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function chunkCartLines<T>(items: T[], chunkSize: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += chunkSize) out.push(items.slice(i, i + chunkSize))
  return out
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
    try {
      last = await fetchWithTimeout('/api/entries/verify-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ entryIds, transactionSignature }),
      })
    } catch (err) {
      // Timeout / network drop consumes a retry instead of aborting the ladder
      // (flaky mobile connections recover between attempts).
      if (i < backoffMs.length - 1) continue
      throw err
    }
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

/**
 * Paid cart batch checkout: create-batch → build tx → wallet sign → attach →
 * on-chain confirm → verify-batch, chunked into CART_BATCH_MAX_RAFFLES_PER_TX.
 *
 * Pure orchestration — no React state. The caller maps the result onto cart
 * lines via computeCartLinesAfterBatchCheckout so paid-but-unverified items
 * are never restored behind the checkout button.
 */
export async function executeCartBatchCheckout(
  opts: ExecuteCartBatchCheckoutOptions
): Promise<ExecuteCartBatchCheckoutResult> {
  const { loaded, publicKey, connection, sendTransaction, onBatchProgress, onReceiptPhase } = opts

  const settledRaffleIds: string[] = []
  const paidUnverifiedRaffleIds: string[] = []

  const failed = (error: string, refresh = false): ExecuteCartBatchCheckoutResult => {
    onReceiptPhase('failed')
    return { ok: false, error, settledRaffleIds, paidUnverifiedRaffleIds, refresh }
  }

  const batches = chunkCartLines(loaded, CART_BATCH_MAX_RAFFLES_PER_TX)

  for (let i = 0; i < batches.length; i++) {
    onBatchProgress(i + 1, batches.length)
    const batch = batches[i]!
    const batchRaffleIds = batch.map(({ line }) => line.raffleId)

    let createResponse: Response
    try {
      createResponse = await fetchWithTimeout('/api/entries/create-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          items: batch.map(({ line }) => ({
            raffleId: line.raffleId,
            ticketQuantity: line.quantity,
          })),
        }),
      })
    } catch {
      return failed(
        'Network error preparing batch checkout. Check your connection (WiFi or mobile data) and try again.'
      )
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
      return failed(msg)
    }

    let batchPayload: {
      entryIds?: string[]
      paymentDetails?: PurchasePaymentDetails
    }
    try {
      batchPayload = await createResponse.json()
    } catch {
      return failed('Invalid response from checkout server.')
    }

    const entryIds = batchPayload.entryIds
    const pd = batchPayload.paymentDetails
    if (!entryIds?.length || !pd) {
      return failed('Invalid batch checkout payload.')
    }

    let signature: string
    try {
      const transaction = await buildPurchaseTransactionFromPaymentDetails(
        connection,
        publicKey,
        String(pd.currency || batch[0]!.fresh.currency || 'SOL'),
        pd
      )
      signature = await sendTransaction(transaction, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      })
      // Persist immediately: if the tab dies on return from the wallet app,
      // resumePendingVerifications retries verify-batch on next load.
      recordPendingVerification({
        kind: 'batch',
        entryIds,
        transactionSignature: signature,
        walletAddress: publicKey.toBase58(),
      })
      const attached = await attachPaymentSignaturesBatch({
        entryIds,
        transactionSignature: signature,
        walletAddress: publicKey.toBase58(),
      })
      if (!attached) {
        console.warn('[cart] attach-tx failed after send; verify-batch may still recover')
      }
    } catch (err: unknown) {
      const wm = err instanceof Error ? err.message : String(err)
      if (/rejected|cancell?ed/i.test(wm)) {
        return failed(
          `Transaction ${i + 1} of ${batches.length} was cancelled. Previous successful batches (if any) were kept.`
        )
      }
      const splHelp = formatSplTokenTransferFailure(wm, String(pd.currency || ''))
      return failed(splHelp ?? (wm.includes('Insufficient') ? wm : `Payment failed: ${wm}`))
    }

    // From here a payment is in-flight: never restore this batch to the cart.
    try {
      await confirmSignatureSuccessOnChain(connection, signature)
    } catch (confirmErr: unknown) {
      const wm = confirmErr instanceof Error ? confirmErr.message : String(confirmErr)
      if (wm.toLowerCase().includes('transaction failed')) {
        // Definitive on-chain failure — no funds moved, safe to restore.
        clearPendingVerification(signature)
        return failed('On-chain transaction failed.', true)
      }
      paidUnverifiedRaffleIds.push(...batchRaffleIds)
      return failed(
        `Transaction confirmation timed out. ${PAID_UNVERIFIED_CART_NOTE}`,
        true
      )
    }

    let verifyRes: Response
    try {
      verifyRes = await fetchVerifyBatchWithRetries(entryIds, signature)
    } catch {
      paidUnverifiedRaffleIds.push(...batchRaffleIds)
      return failed(`Network error confirming tickets. ${PAID_UNVERIFIED_CART_NOTE}`, true)
    }

    if (verifyRes.status === 202) {
      // Keep the pending-verification record so resume passes finish the job.
      onReceiptPhase('pending_async')
      settledRaffleIds.push(...batchRaffleIds)
      continue
    }

    if (!verifyRes.ok) {
      paidUnverifiedRaffleIds.push(...batchRaffleIds)
      const { status, code } = await parseVerifyBatchFailure(verifyRes)
      return failed(`${verifyBatchFailureUserMessage(status, code)} ${PAID_UNVERIFIED_CART_NOTE}`, true)
    }

    clearPendingVerification(signature)
    settledRaffleIds.push(...batchRaffleIds)
  }

  onReceiptPhase('success')
  return { ok: true, error: null, settledRaffleIds, paidUnverifiedRaffleIds, refresh: true }
}
