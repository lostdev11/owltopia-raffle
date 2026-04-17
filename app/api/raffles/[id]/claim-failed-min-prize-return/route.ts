import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/auth-server'
import {
  acquireNftPrizeClaimLock,
  clearNftPrizeClaimLock,
  getRaffleById,
} from '@/lib/db/raffles'
import {
  transferNftPrizeToCreator,
  transferPartnerSplPrizeToCreator,
} from '@/lib/raffles/prize-escrow'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/claim-failed-min-prize-return
 * Creator-only: after min tickets were not met past the allowed extension (`failed_refund_available`),
 * retry returning the verified escrow prize (NFT or partner SPL) to the creator wallet.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`claim-failed-min-prize-return:${ip}`, 24, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const params = await context.params
    const raffleId = params.id
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const idRl = rateLimit(`claim-failed-min-prize-return:raffle:${raffleId}`, 8, 60_000)
    if (!idRl.allowed) {
      return NextResponse.json({ error: 'Too many requests for this raffle' }, { status: 429 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const sessionWallet = session.wallet.trim()
    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    if (!creatorWallet || creatorWallet !== sessionWallet) {
      return NextResponse.json({ error: 'Only the raffle creator can claim this return' }, { status: 403 })
    }

    if (raffle.status !== 'failed_refund_available') {
      return NextResponse.json(
        {
          error:
            'This raffle is not in refund-available state (minimum threshold flow). Open the raffle page once if it just ended.',
        },
        { status: 400 }
      )
    }

    if (raffle.winner_wallet?.trim() || (raffle.winner_selected_at && String(raffle.winner_selected_at).trim())) {
      return NextResponse.json({ error: 'This raffle already has a winner selected' }, { status: 400 })
    }

    const partnerSpl = isPartnerSplPrizeRaffle(raffle)
    if (!partnerSpl && (raffle.prize_type !== 'nft' || !raffle.nft_mint_address?.trim())) {
      return NextResponse.json(
        { error: 'This raffle does not have an escrowed NFT or partner token prize to return' },
        { status: 400 }
      )
    }

    if (!raffle.prize_deposited_at) {
      return NextResponse.json(
        { error: 'Prize deposit is not verified for this raffle; nothing to return from escrow yet' },
        { status: 400 }
      )
    }

    if (raffle.nft_transfer_transaction?.trim()) {
      return NextResponse.json({ error: 'Prize was already sent to a winner' }, { status: 400 })
    }

    if (raffle.prize_returned_at) {
      return NextResponse.json({
        success: true as const,
        alreadyReturned: true,
        transactionSignature: raffle.prize_return_tx ?? undefined,
      })
    }

    const { acquired } = await acquireNftPrizeClaimLock(raffleId, sessionWallet)
    if (!acquired) {
      return NextResponse.json(
        { error: 'A return or claim is already in progress for this raffle. Try again shortly.' },
        { status: 423 }
      )
    }

    try {
      const result = partnerSpl
        ? await transferPartnerSplPrizeToCreator(raffleId, 'min_threshold_not_met')
        : await transferNftPrizeToCreator(raffleId, 'min_threshold_not_met')

      if (!result.ok || !result.signature) {
        await clearNftPrizeClaimLock(raffleId)
        return NextResponse.json(
          { error: result.error ?? 'Failed to return prize from escrow' },
          { status: 400 }
        )
      }

      return NextResponse.json({
        success: true as const,
        transactionSignature: result.signature,
      })
    } catch (inner) {
      await clearNftPrizeClaimLock(raffleId)
      throw inner
    }
  } catch (error) {
    console.error('[claim-failed-min-prize-return]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
