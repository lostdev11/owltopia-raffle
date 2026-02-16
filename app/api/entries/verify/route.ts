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
import { safeErrorMessage } from '@/lib/safe-error'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

/**
 * Server-side payment verification endpoint.
 * Validates blockchain transaction first (finalized, destination, amount, sender),
 * then atomically confirms entry via RPC (lock, verified_transactions, max_tickets, update).
 * Idempotent: same entry + same tx already confirmed → 200 success.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`entries-verify:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(entriesVerifyBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { entryId, transactionSignature } = parsed.data

    const entry = await getEntryById(entryId)
    if (!entry) {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      )
    }

    const raffle = await getRaffleById(entry.raffle_id)
    if (!raffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    // --- 1) Validate blockchain transaction FIRST (no DB write until verified) ---
    // Confirms finalized, correct destination, amount, sender matches entry wallet
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
        return NextResponse.json(
          {
            error: 'Transaction verification failed temporarily',
            details: verificationResult.error || 'Unknown verification error',
            retry: true,
            message:
              'The transaction may still be confirming. Please try again in a moment.',
          },
          { status: 202 }
        )
      }

      // Permanent failure: reject entry
      await updateEntryStatus(entryId, 'rejected', transactionSignature)
      return NextResponse.json(
        {
          error: 'Transaction verification failed',
          details: verificationResult.error || 'Unknown verification error',
        },
        { status: 400 }
      )
    }

    // --- 2) Atomic RPC: lock raffle + entry, verified_transactions, max_tickets, update entry ---
    const result = await confirmEntryWithTx(
      entryId,
      entry.raffle_id,
      entry.wallet_address,
      transactionSignature,
      Number(entry.amount_paid),
      entry.ticket_quantity
    )

    // Success or idempotent (same entry + same tx already confirmed)
    return NextResponse.json({ success: true, entry: result.entry })
  } catch (error) {
    if (
      error instanceof TxAlreadyUsedError ||
      error instanceof TransactionSignatureAlreadyUsedError
    ) {
      return NextResponse.json(
        { error: 'Transaction signature already used for another entry' },
        { status: 400 }
      )
    }
    if (error instanceof InsufficientTicketsError) {
      return NextResponse.json(
        {
          error: error.message,
          details: 'Would exceed maximum ticket limit for this raffle.',
        },
        { status: 400 }
      )
    }
    if (error instanceof ConfirmEntryInvalidStateError) {
      return NextResponse.json(
        { error: error.message || 'Invalid entry state for confirmation' },
        { status: 400 }
      )
    }
    console.error('Error verifying entry:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
