import { NextRequest, NextResponse } from 'next/server'

import { forbidUnlessSelfOrAdmin } from '@/lib/api-wallet-auth'
import { requireSession } from '@/lib/auth-server'
import { getRaffleBySlug } from '@/lib/db/raffles'
import { getEntriesByRaffleId } from '@/lib/db/raffles'
import { updateEntryStatus } from '@/lib/db/entries'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

/**
 * Check entry status for a specific wallet and raffle; may verify pending on-chain txs.
 * SIWS required. Callers may only query their own wallet unless they are DB admin.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json()
    const { walletAddress, raffleSlug } = body

    if (!walletAddress || !raffleSlug) {
      return NextResponse.json(
        { error: 'Missing required fields: walletAddress, raffleSlug' },
        { status: 400 }
      )
    }

    const authz = await forbidUnlessSelfOrAdmin(session, String(walletAddress))
    if (authz) return authz

    // Get raffle by slug
    const raffle = await getRaffleBySlug(raffleSlug)
    if (!raffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    // Get all entries for this raffle
    const allEntries = await getEntriesByRaffleId(raffle.id)
    
    // Find entries for this wallet
    const walletEntries = allEntries.filter(
      e => e.wallet_address.toLowerCase() === walletAddress.toLowerCase()
    )

    // Try to verify any pending entries with transaction signatures
    const pendingWithTx = walletEntries.filter(
      e => e.status === 'pending' && e.transaction_signature
    )

    const verificationResults = []
    if (pendingWithTx.length > 0) {
      // Import verification function from shared utility
      const { verifyTransaction } = await import('@/lib/verify-transaction')
      
      for (const entry of pendingWithTx) {
        try {
          const result = await verifyTransaction(
            entry.transaction_signature!,
            entry,
            raffle
          )
          
          if (result.valid) {
            await updateEntryStatus(entry.id, 'confirmed', entry.transaction_signature || undefined)
            verificationResults.push({
              entryId: entry.id,
              status: 'verified',
              message: 'Entry successfully verified and confirmed'
            })
          } else {
            verificationResults.push({
              entryId: entry.id,
              status: 'failed',
              error: result.error
            })
          }
        } catch (error: any) {
          verificationResults.push({
            entryId: entry.id,
            status: 'error',
            error: error.message || 'Verification error'
          })
        }
      }
    }

    // Group entries by status
    const byStatus = {
      confirmed: walletEntries.filter(e => e.status === 'confirmed'),
      pending: walletEntries.filter(e => e.status === 'pending'),
      rejected: walletEntries.filter(e => e.status === 'rejected'),
    }

    return NextResponse.json({
      raffle: {
        id: raffle.id,
        slug: raffle.slug,
        title: raffle.title,
      },
      wallet: walletAddress,
      entries: {
        all: walletEntries,
        byStatus,
        total: walletEntries.length,
        confirmedCount: byStatus.confirmed.length,
        pendingCount: byStatus.pending.length,
        rejectedCount: byStatus.rejected.length,
      },
      verificationAttempts: verificationResults,
      summary: {
        totalTickets: walletEntries
          .filter(e => e.status === 'confirmed')
          .reduce((sum, e) => sum + e.ticket_quantity, 0),
        pendingTickets: walletEntries
          .filter(e => e.status === 'pending')
          .reduce((sum, e) => sum + e.ticket_quantity, 0),
      }
    })
  } catch (error) {
    console.error('Error checking entry:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
