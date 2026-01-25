import { NextRequest, NextResponse } from 'next/server'
import { getEntriesByRaffleId, getRaffleById } from '@/lib/db/raffles'
import { updateEntryStatus } from '@/lib/db/entries'
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

    const entries = await getEntriesByRaffleId(raffleId)

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

  for (const entry of pendingEntries) {
    if (!entry.transaction_signature) {
      // Entry has no transaction signature yet - skip (waiting for user to complete transaction)
      continue
    }

    try {
      const verificationResult = await verifyTransaction(
        entry.transaction_signature,
        entry,
        raffle
      )

      if (verificationResult.valid) {
        await updateEntryStatus(entry.id, 'confirmed', entry.transaction_signature ?? undefined)
        console.log(`✅ Auto-verified entry ${entry.id} for raffle ${raffleId}`)
      } else {
        // Check if this is a temporary error that might resolve
        const isTemporaryError = verificationResult.error?.includes('Transaction not found') ||
                                  verificationResult.error?.includes('still be confirming') ||
                                  verificationResult.error?.includes('temporary issue') ||
                                  verificationResult.error?.includes('Verification error')
        
        if (isTemporaryError) {
          // Leave as pending for retry - don't log as error, just info
          console.log(`⏳ Entry ${entry.id} verification pending (temporary error): ${verificationResult.error}`)
          continue
        }
        
        // Permanent failure - reject
        await updateEntryStatus(entry.id, 'rejected', entry.transaction_signature ?? undefined)
        console.log(`❌ Auto-rejected entry ${entry.id}: ${verificationResult.error}`)
      }
    } catch (error: any) {
      console.error(`⚠️ Error auto-verifying entry ${entry.id}:`, error.message)
      // Don't update status on error, let it retry next time
      // This handles network errors, RPC issues, etc.
    }
  }
}
