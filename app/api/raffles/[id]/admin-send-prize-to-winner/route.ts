import { NextRequest, NextResponse } from 'next/server'
import { clearNftPrizeClaimLock, getRaffleById } from '@/lib/db/raffles'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import {
  transferCompressedPrizeToWinner,
  transferMplCorePrizeToWinner,
  transferNftPrizeToWinner,
} from '@/lib/raffles/prize-escrow'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/admin-send-prize-to-winner
 * Full admin only: signs and sends the NFT from platform escrow to the recorded winner
 * (same on-chain path as winner "Claim prize"). Clears any claim lock first so ops can
 * recover from failed winner attempts.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
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
    if (raffle.prize_type !== 'nft' || !raffle.nft_mint_address) {
      return NextResponse.json(
        { error: 'This raffle does not have an NFT prize to send' },
        { status: 400 }
      )
    }
    if (!raffle.winner_wallet?.trim()) {
      return NextResponse.json({ error: 'Raffle has no winner yet' }, { status: 400 })
    }
    if (!raffle.prize_deposited_at) {
      return NextResponse.json(
        { error: 'Prize deposit is not verified for this raffle' },
        { status: 400 }
      )
    }
    if (raffle.nft_transfer_transaction) {
      return NextResponse.json({
        success: true,
        alreadySent: true,
        transactionSignature: raffle.nft_transfer_transaction,
      })
    }
    if (raffle.prize_returned_at) {
      return NextResponse.json(
        { error: 'Prize was returned to the creator; cannot send to winner' },
        { status: 400 }
      )
    }
    const status = (raffle.status ?? '').trim().toLowerCase()
    if (status === 'cancelled') {
      return NextResponse.json(
        { error: 'Raffle is cancelled; resolve cancellation before sending the prize' },
        { status: 400 }
      )
    }

    await clearNftPrizeClaimLock(raffleId)

    let transferResult =
      raffle.prize_standard === 'mpl_core'
        ? await transferMplCorePrizeToWinner(raffleId)
        : raffle.prize_standard === 'compressed'
          ? await transferCompressedPrizeToWinner(raffleId)
          : await transferNftPrizeToWinner(raffleId)

    if (
      raffle.prize_standard !== 'mpl_core' &&
      raffle.prize_standard !== 'compressed' &&
      (!transferResult.ok || !transferResult.signature) &&
      typeof transferResult.error === 'string' &&
      transferResult.error.includes('Escrow does not hold this NFT')
    ) {
      transferResult = await transferCompressedPrizeToWinner(raffleId)
    }

    if (!transferResult.ok || !transferResult.signature) {
      return NextResponse.json(
        { error: transferResult.error || 'Failed to send NFT from escrow' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      transactionSignature: transferResult.signature,
    })
  } catch (error) {
    console.error('[admin-send-prize-to-winner]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
