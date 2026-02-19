import { NextRequest, NextResponse } from 'next/server'
import {
  getEntryById,
  confirmEntryWithTx,
  updateEntryStatus,
  TxAlreadyUsedError,
  InsufficientTicketsError,
  ConfirmEntryInvalidStateError,
  TransactionSignatureAlreadyUsedError,
} from '@/lib/db/entries'
import { getRaffleById } from '@/lib/db/raffles'
import { verifyTransaction } from '@/lib/verify-transaction'
import { entriesVerifyBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import {
  tryAcquireVerificationLock,
  releaseVerificationLock,
} from '@/lib/verify-in-flight'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

// Single generic error for all failures — no signal to attackers (rate limit, state, etc.)
const ERROR_BODY = { success: false as const, error: 'server error' }

// Stricter limits so bursts cannot bypass: 40/min per IP, 5/min per wallet
const VERIFY_IP_LIMIT = 40
const VERIFY_WALLET_LIMIT = 5
const VERIFY_WINDOW_MS = 60_000

/**
 * Server-side payment verification endpoint.
 * Validates blockchain transaction first (finalized, destination, amount, sender),
 * then atomically confirms entry via RPC (lock, verified_transactions, max_tickets, update).
 * Idempotent: same entry + same tx already confirmed → 200 success.
 * Responses are minimal and non-informative to prevent exploit reconnaissance.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const ipRl = rateLimit(`entries-verify:ip:${ip}`, VERIFY_IP_LIMIT, VERIFY_WINDOW_MS)
    if (!ipRl.allowed) {
      return NextResponse.json(
        ERROR_BODY,
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(entriesVerifyBody, body)
    if (!parsed.ok) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    const { entryId, transactionSignature } = parsed.data

    const entry = await getEntryById(entryId)
    if (!entry) {
      return NextResponse.json(ERROR_BODY, { status: 404 })
    }

    const walletRl = rateLimit(
      `entries-verify:wallet:${entry.wallet_address}`,
      VERIFY_WALLET_LIMIT,
      VERIFY_WINDOW_MS
    )
    if (!walletRl.allowed) {
      return NextResponse.json(
        ERROR_BODY,
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    // Sequential processing: only one verify per entryId at a time (reject duplicates)
    if (!tryAcquireVerificationLock(entryId)) {
      return NextResponse.json(
        ERROR_BODY,
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    try {
      if (entry.status !== 'pending') {
        return NextResponse.json(ERROR_BODY, { status: 400 })
      }

      const raffle = await getRaffleById(entry.raffle_id)
      if (!raffle) {
        return NextResponse.json(ERROR_BODY, { status: 404 })
      }

      // --- 1) Validate blockchain transaction FIRST (no DB write until verified) ---
      const verificationResult = await verifyTransaction(
        transactionSignature,
        entry,
        raffle
      )

      if (!verificationResult.valid) {
        const isTemporaryError =
          verificationResult.error?.includes('Transaction not found') ||
          verificationResult.error?.includes('still be confirming') ||
          verificationResult.error?.includes('temporary issue') ||
          verificationResult.error?.includes('Verification error')

        if (isTemporaryError) {
          console.log(
            `Verification failed temporarily for entry ${entryId}. Error: ${verificationResult.error}`
          )
          return NextResponse.json(ERROR_BODY, { status: 202 })
        }

        await updateEntryStatus(entryId, 'rejected', transactionSignature)
        return NextResponse.json(ERROR_BODY, { status: 400 })
      }

      // --- 2) Atomic RPC: lock raffle + entry, verified_transactions, max_tickets, update entry ---
      // Entry is only "released" (lock removed) after this completes — reset-after-verify ordering
      const result = await confirmEntryWithTx(
        entryId,
        entry.raffle_id,
        entry.wallet_address,
        transactionSignature,
        Number(entry.amount_paid),
        entry.ticket_quantity
      )

      return NextResponse.json({
        success: true,
        entryId: result.entry.id,
        transactionSignature: result.entry.transaction_signature ?? transactionSignature,
      })
    } finally {
      releaseVerificationLock(entryId)
    }
  } catch (error) {
    if (
      error instanceof TxAlreadyUsedError ||
      error instanceof TransactionSignatureAlreadyUsedError
    ) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    if (error instanceof InsufficientTicketsError) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    if (error instanceof ConfirmEntryInvalidStateError) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    console.error('Error verifying entry:', error)
    return NextResponse.json(ERROR_BODY, { status: 500 })
  }
}
