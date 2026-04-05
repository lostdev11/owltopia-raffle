import { NextRequest, NextResponse } from 'next/server'
import {
  acquireCreatorFundsClaimLock,
  clearCreatorFundsClaimLock,
  getRaffleById,
  maybeCompleteRaffleAfterClaims,
  updateRaffle,
} from '@/lib/db/raffles'
import { requireSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import { payoutCreatorAndPlatformFromFundsEscrow } from '@/lib/raffles/funds-escrow'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/claim-proceeds
 * Creator claims net ticket proceeds (+ sends platform fee to treasury) from funds escrow.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const raffleId = params.id
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    if (!raffleUsesFundsEscrow(raffle)) {
      return NextResponse.json(
        { error: 'This raffle did not use funds escrow settlement.' },
        { status: 400 }
      )
    }

    if (raffle.status !== 'successful_pending_claims') {
      return NextResponse.json(
        { error: 'Proceeds can only be claimed after the draw and while claims are pending.' },
        { status: 400 }
      )
    }

    if (!String(raffle.settled_at ?? '').trim()) {
      return NextResponse.json(
        {
          error:
            'Proceeds can only be claimed after the raffle has settled (winner drawn and payout amounts recorded).',
        },
        { status: 400 }
      )
    }

    const creator = (raffle.creator_wallet || raffle.created_by || '').trim()
    if (!creator || creator !== session.wallet.trim()) {
      return NextResponse.json({ error: 'Only the raffle creator can claim proceeds.' }, { status: 403 })
    }

    if (raffle.creator_claimed_at) {
      return NextResponse.json({
        success: true,
        alreadyClaimed: true,
        transactionSignature: raffle.creator_claim_tx,
      })
    }

    const { acquired } = await acquireCreatorFundsClaimLock(raffleId, session.wallet)
    if (!acquired) {
      return NextResponse.json(
        { error: 'Claim is already in progress. Try again in a moment.' },
        { status: 423 }
      )
    }

    try {
      const result = await payoutCreatorAndPlatformFromFundsEscrow(raffle)
      if (!result.ok) {
        await clearCreatorFundsClaimLock(raffleId)
        return NextResponse.json(
          { error: result.error || 'Payout failed' },
          { status: 400 }
        )
      }

      const now = new Date().toISOString()
      await updateRaffle(raffleId, {
        creator_claimed_at: now,
        creator_claim_tx: result.signature,
        creator_funds_claim_locked_at: null,
      })

      await maybeCompleteRaffleAfterClaims(raffleId)

      return NextResponse.json({
        success: true,
        transactionSignature: result.signature,
      })
    } catch (e) {
      await clearCreatorFundsClaimLock(raffleId)
      throw e
    }
  } catch (error) {
    console.error('[claim-proceeds]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
