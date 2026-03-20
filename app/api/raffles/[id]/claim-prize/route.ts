import { NextRequest, NextResponse } from 'next/server'
import { acquireNftPrizeClaimLock, getRaffleById } from '@/lib/db/raffles'
import { requireSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import {
  transferMplCorePrizeToWinner,
  transferNftPrizeToWinner,
} from '@/lib/raffles/prize-escrow'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/claim-prize
 * Winner-only endpoint to claim an NFT prize from escrow.
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
    if (raffle.prize_type !== 'nft' || !raffle.nft_mint_address) {
      return NextResponse.json(
        { error: 'This raffle does not have an NFT prize to claim' },
        { status: 400 }
      )
    }
    if (!raffle.winner_wallet) {
      return NextResponse.json(
        { error: 'Winner has not been selected yet' },
        { status: 400 }
      )
    }

    const winnerWallet = raffle.winner_wallet.trim()
    const sessionWallet = session.wallet.trim()
    if (winnerWallet !== sessionWallet) {
      return NextResponse.json(
        { error: 'Only the selected winner can claim this prize' },
        { status: 403 }
      )
    }

    if (raffle.status !== 'completed') {
      return NextResponse.json(
        { error: 'Prize can only be claimed after the raffle has completed' },
        { status: 400 }
      )
    }

    if (raffle.prize_returned_at) {
      return NextResponse.json(
        { error: 'Prize was returned to creator and is no longer claimable' },
        { status: 400 }
      )
    }
    if (raffle.nft_transfer_transaction) {
      return NextResponse.json({
        success: true,
        alreadyClaimed: true,
        transactionSignature: raffle.nft_transfer_transaction,
      })
    }
    if (!raffle.prize_deposited_at) {
      return NextResponse.json(
        { error: 'Prize has not been deposited to escrow yet' },
        { status: 400 }
      )
    }

    const { acquired } = await acquireNftPrizeClaimLock(raffleId, sessionWallet)
    if (!acquired) {
      return NextResponse.json(
        { error: 'Prize is being claimed right now. Please try again in a moment.' },
        { status: 423 }
      )
    }

    const transferResult =
      raffle.prize_standard === 'mpl_core'
        ? await transferMplCorePrizeToWinner(raffleId)
        : await transferNftPrizeToWinner(raffleId)

    if (!transferResult.ok || !transferResult.signature) {
      return NextResponse.json(
        { error: transferResult.error || 'Failed to claim NFT prize' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      transactionSignature: transferResult.signature,
    })
  } catch (error) {
    console.error('[claim-prize]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
