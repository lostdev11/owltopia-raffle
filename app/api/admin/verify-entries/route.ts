import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { getEntriesByRaffleId, getRaffleById } from '@/lib/db/raffles'
import {
  updateEntryStatus,
  confirmEntryWithTx,
  TxAlreadyUsedError,
  InsufficientTicketsError,
  ConfirmEntryInvalidStateError,
} from '@/lib/db/entries'
import { verifyTransaction } from '@/lib/verify-transaction'
import { safeErrorMessage } from '@/lib/safe-error'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

/**
 * Admin endpoint to batch verify pending entries for a raffle.
 * Admin only (session required). Body: { raffleId }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const { raffleId } = body

    if (!raffleId) {
      return NextResponse.json(
        { error: 'Missing required field: raffleId' },
        { status: 400 }
      )
    }

    // Get raffle
    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    // Get all entries for the raffle
    const allEntries = await getEntriesByRaffleId(raffleId)
    
    // Filter to pending entries that have transaction signatures
    const pendingEntries = allEntries.filter(
      e => e.status === 'pending' && e.transaction_signature
    )

    if (pendingEntries.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending entries with transaction signatures found',
        verified: 0,
        rejected: 0,
        skipped: 0
      })
    }

    // Verify each pending entry
    const results = {
      verified: 0,
      rejected: 0,
      errors: [] as string[]
    }

    for (const entry of pendingEntries) {
      try {
        const verificationResult = await verifyTransaction(
          entry.transaction_signature!,
          entry,
          raffle
        )

        if (!verificationResult.valid) {
          await updateEntryStatus(entry.id, 'rejected', entry.transaction_signature ?? undefined)
          results.rejected++
          results.errors.push(
            `Entry ${entry.id}: ${verificationResult.error || 'Verification failed'}`
          )
          continue
        }

        // Use atomic RPC so verified_transactions is updated (prevents tx replay)
        await confirmEntryWithTx(
          entry.id,
          entry.raffle_id,
          entry.wallet_address,
          entry.transaction_signature!,
          Number(entry.amount_paid),
          entry.ticket_quantity
        )
        results.verified++
      } catch (error: any) {
        results.rejected++
        const msg =
          error instanceof TxAlreadyUsedError
            ? 'Transaction already used for another entry'
            : error instanceof InsufficientTicketsError
              ? error.message
              : error instanceof ConfirmEntryInvalidStateError
                ? error.message
                : error?.message || 'Verification error'
        results.errors.push(`Entry ${entry.id}: ${msg}`)
        if (!(error instanceof TxAlreadyUsedError)) {
          console.error(`Error verifying entry ${entry.id}:`, error)
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Verified ${results.verified} entries, rejected ${results.rejected}`,
      verified: results.verified,
      rejected: results.rejected,
      errors: results.errors
    })
  } catch (error) {
    // Don't log full error object which might contain wallet addresses
    console.error('Error in batch verify entries:', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
