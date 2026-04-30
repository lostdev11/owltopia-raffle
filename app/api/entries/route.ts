import { NextRequest, NextResponse } from 'next/server'
import { getEntriesByRaffleId, getRaffleById } from '@/lib/db/raffles'
import {
  confirmCartBatchWithTx,
  confirmEntryWithTx,
  ConfirmEntryInvalidStateError,
  getPendingEntriesByTransactionSignature,
  InsufficientTicketsError,
  TransactionSignatureAlreadyUsedError,
  TxAlreadyUsedError,
} from '@/lib/db/entries'
import { verifyBatchPaidEntries } from '@/lib/verify-batch-transaction'
import { verifyTransaction } from '@/lib/verify-transaction'
import type { Entry } from '@/lib/types'

// Force dynamic rendering to prevent caching stale entry data
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET entries for a specific raffle
 * Query params: raffleId - the ID of the raffle
 * 
 * Automatically verifies pending entries with transaction signatures in the background
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const raffleId = searchParams.get('raffleId')

    if (!raffleId) {
      return NextResponse.json(
        { error: 'Missing required parameter: raffleId' },
        { status: 400 }
      )
    }

    // Validate UUID format to avoid unnecessary DB load and consistent error handling
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!UUID_REGEX.test(raffleId.trim())) {
      return NextResponse.json(
        { error: 'Invalid raffleId format' },
        { status: 400 }
      )
    }

    const entries = await getEntriesByRaffleId(raffleId.trim())

    // Automatically verify pending entries with transaction signatures in the background
    // This runs asynchronously so it doesn't block the response
    const pendingWithSignatures = entries.filter(
      e => e.status === 'pending' && e.transaction_signature
    )
    
    if (pendingWithSignatures.length > 0) {
      // Run verification in background (don't await)
      verifyPendingEntries(raffleId, pendingWithSignatures).catch(error => {
        console.error('Error in background verification:', error)
      })
    }

    // Return response with no-cache headers to ensure fresh data
    return NextResponse.json(entries, { 
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    })
  } catch (error) {
    console.error('Error fetching entries:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

/**
 * Verify pending entries in the background
 * This runs automatically when entries are fetched, providing retry mechanism
 */
async function verifyPendingEntries(raffleId: string, pendingEntries: Entry[]) {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) return

  const processedBatchSignatures = new Set<string>()

  for (const entry of pendingEntries) {
    if (!entry.transaction_signature) {
      // Entry has no transaction signature yet - skip (waiting for user to complete transaction)
      continue
    }

    const sig = entry.transaction_signature.trim()
    if (!sig) continue

    if (!processedBatchSignatures.has(sig)) {
      const peers = await getPendingEntriesByTransactionSignature(sig)
      const batchGroup = peers.filter(
        e => e.wallet_address.trim() === entry.wallet_address.trim() && e.status === 'pending'
      )

      if (batchGroup.length >= 2) {
        batchGroup.sort((a, b) => {
          const r = String(a.raffle_id).localeCompare(String(b.raffle_id))
          return r !== 0 ? r : String(a.id).localeCompare(String(b.id))
        })

        const pairs: { entry: Entry; raffle: NonNullable<Awaited<ReturnType<typeof getRaffleById>>> }[] =
          []
        for (const e of batchGroup) {
          const r = await getRaffleById(e.raffle_id)
          if (!r) {
            console.warn(`[entries GET] batch auto-verify: raffle ${e.raffle_id} missing for entry ${e.id}`)
            continue
          }
          pairs.push({ entry: e, raffle: r })
        }

        if (pairs.length < 2) {
          console.warn(
            `[entries GET] cart batch has ${batchGroup.length} pending rows for sig ${sig.slice(0, 8)}… but only ${pairs.length} raffles loaded — skipping (do not use single-tx verify)`
          )
          continue
        }

        processedBatchSignatures.add(sig)
        try {
          const blockchain = await verifyBatchPaidEntries(sig, pairs)
          if (!blockchain.valid) {
            const err = blockchain.error || ''
            const isTemporary =
              err.includes('Transaction not found') ||
              err.includes('still be confirming') ||
              err.includes('temporary issue') ||
              err.includes('Verification error') ||
              err.includes('Transaction metadata not available')

            if (isTemporary) {
              console.log(`⏳ Cart batch auto-verify pending (temporary): ${err.slice(0, 220)}`)
            } else {
              console.warn(
                `⚠️ Cart batch auto-verify on-chain check failed (kept pending): ${err.slice(0, 280)}`
              )
            }
            continue
          }

          try {
            await confirmCartBatchWithTx(
              pairs[0]!.entry.wallet_address.trim(),
              sig,
              pairs.map(p => p.entry.id)
            )
            console.log(`✅ Auto-verified cart batch (${pairs.length} entries) for tx ${sig.slice(0, 12)}…`)
          } catch (e) {
            if (e instanceof ConfirmEntryInvalidStateError) {
              console.log(`Cart batch confirm skipped (invalid state): ${e.message}`)
            } else if (e instanceof InsufficientTicketsError) {
              console.warn(`Cart batch auto-verify: insufficient tickets`, e.message)
            } else if (
              e instanceof TxAlreadyUsedError ||
              e instanceof TransactionSignatureAlreadyUsedError
            ) {
              console.warn(`Cart batch auto-verify: tx already used`)
            } else {
              console.error(`Cart batch auto-verify: confirm_cart_batch_with_tx failed`, e)
            }
          }
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error)
          console.error(`⚠️ Cart batch auto-verify error (${sig.slice(0, 8)}…):`, msg)
        }
        continue
      }
    }

    try {
      const verificationResult = await verifyTransaction(sig, entry, raffle)

      if (verificationResult.valid) {
        try {
          await confirmEntryWithTx(
            entry.id,
            entry.raffle_id,
            entry.wallet_address,
            sig,
            Number(entry.amount_paid),
            entry.ticket_quantity
          )
          console.log(`✅ Auto-verified entry ${entry.id} for raffle ${raffleId}`)
        } catch (e) {
          if (e instanceof ConfirmEntryInvalidStateError) {
            console.log(`Entry ${entry.id} skipped confirm (no longer pending or already finalized)`)
          } else if (e instanceof InsufficientTicketsError) {
            console.warn(`Auto-verify: insufficient tickets for entry ${entry.id} on raffle ${raffleId}`)
          } else if (e instanceof TxAlreadyUsedError) {
            console.warn(`Auto-verify: tx already used for entry ${entry.id}`)
          } else {
            console.error(`Auto-verify: confirm RPC failed for entry ${entry.id}:`, e)
          }
        }
      } else {
        // Check if this is a temporary error that might resolve
        const isTemporaryError =
          verificationResult.error?.includes('Transaction not found') ||
          verificationResult.error?.includes('still be confirming') ||
          verificationResult.error?.includes('temporary issue') ||
          verificationResult.error?.includes('Verification error')

        if (isTemporaryError) {
          // Leave as pending for retry - don't log as error, just info
          console.log(
            `⏳ Entry ${entry.id} verification pending (temporary error): ${verificationResult.error}`
          )
          continue
        }

        // For non-temporary verification failures, keep the entry pending so it
        // can be manually reviewed or retried via admin restore flows instead
        // of marking it as permanently rejected when funds may have been sent.
        console.warn(
          `⚠️ Verification failed for entry ${entry.id} (kept as pending, not rejected): ${verificationResult.error}`
        )
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`⚠️ Error auto-verifying entry ${entry.id}:`, msg)
      // Don't update status on error, let it retry next time
      // This handles network errors, RPC issues, etc.
    }
  }
}
