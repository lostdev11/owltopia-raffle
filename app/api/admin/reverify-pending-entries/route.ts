import { NextRequest, NextResponse } from 'next/server'
import {
  getPendingEntriesWithTransactionSignature,
  confirmEntryWithTx,
  TxAlreadyUsedError,
  InsufficientTicketsError,
  ConfirmEntryInvalidStateError,
} from '@/lib/db/entries'
import { getRaffleById } from '@/lib/db/raffles'
import { verifyTransaction } from '@/lib/verify-transaction'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/reverify-pending-entries
 * Full admin. Re-run chain verification + confirmEntryWithTx for pending rows that already
 * have a transaction signature (e.g. fixed verifier, old USDC v0 txs, pre-escrow raffles).
 *
 * Body (optional): { limit?: number (1–200, default 60), currency?: 'SOL' | 'USDC' | 'OWL' }
 *
 * Does not mark entries rejected on failure — only confirms when verification succeeds.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const limit =
      typeof body.limit === 'number' && Number.isFinite(body.limit)
        ? body.limit
        : 60
    const currency =
      typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : undefined

    const entries = await getPendingEntriesWithTransactionSignature({
      limit,
      currency:
        currency === 'SOL' || currency === 'USDC' || currency === 'OWL' ? currency : undefined,
    })

    if (entries.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending entries with a saved transaction signature.',
        processed: 0,
        verified: 0,
        skippedTemporary: 0,
        skippedFailed: 0,
        errors: [] as string[],
      })
    }

    const raffleCache = new Map<string, Awaited<ReturnType<typeof getRaffleById>>>()

    const results = {
      verified: 0,
      skippedTemporary: 0,
      skippedFailed: 0,
      errors: [] as string[],
    }

    for (const entry of entries) {
      const sig = entry.transaction_signature?.trim()
      if (!sig) {
        results.skippedFailed++
        continue
      }

      let raffle = raffleCache.get(entry.raffle_id)
      if (raffle === undefined) {
        raffle = await getRaffleById(entry.raffle_id)
        raffleCache.set(entry.raffle_id, raffle ?? null)
      }
      if (!raffle) {
        results.skippedFailed++
        results.errors.push(`Entry ${entry.id}: raffle not found`)
        continue
      }

      try {
        const verificationResult = await verifyTransaction(sig, entry, raffle, {
          allowExpired: true,
        })

        if (!verificationResult.valid) {
          const errMsg = verificationResult.error || ''

          const isTemporaryError =
            errMsg.includes('Transaction not found') ||
            errMsg.includes('still be confirming') ||
            errMsg.includes('temporary issue') ||
            errMsg.includes('Verification error')

          if (isTemporaryError) {
            results.skippedTemporary++
            results.errors.push(`Entry ${entry.id}: temporary (${errMsg.slice(0, 120)})`)
            continue
          }

          results.skippedFailed++
          results.errors.push(`Entry ${entry.id}: ${errMsg.slice(0, 200)}`)
          continue
        }

        await confirmEntryWithTx(
          entry.id,
          entry.raffle_id,
          entry.wallet_address,
          sig,
          Number(entry.amount_paid),
          entry.ticket_quantity
        )
        results.verified++
      } catch (error: unknown) {
        const msg =
          error instanceof TxAlreadyUsedError
            ? 'Transaction already used for another entry'
            : error instanceof InsufficientTicketsError
              ? error.message
              : error instanceof ConfirmEntryInvalidStateError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : 'Verification error'
        results.skippedFailed++
        results.errors.push(`Entry ${entry.id}: ${msg}`)
        if (!(error instanceof TxAlreadyUsedError) && !(error instanceof ConfirmEntryInvalidStateError)) {
          console.error(`reverify-pending-entries entry ${entry.id}:`, error)
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${entries.length} pending entries: ${results.verified} confirmed, ${results.skippedTemporary} skipped (temporary RPC), ${results.skippedFailed} skipped (failed). Run again if more rows remain.`,
      processed: entries.length,
      verified: results.verified,
      skippedTemporary: results.skippedTemporary,
      skippedFailed: results.skippedFailed,
      errors: results.errors,
    })
  } catch (error) {
    console.error('reverify-pending-entries:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
