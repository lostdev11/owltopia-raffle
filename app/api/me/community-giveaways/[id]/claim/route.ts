import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import {
  acquireCommunityGiveawayClaimLock,
  clearCommunityGiveawayClaimLock,
  getCommunityGiveawayById,
  markCommunityGiveawayClaimed,
} from '@/lib/db/community-giveaways'
import {
  communityGiveawayToEscrowProbe,
  payoutNftPrizeFromEscrowToRecipient,
} from '@/lib/giveaways/payout-nft-giveaway'
import { checkEscrowHoldsNft } from '@/lib/raffles/prize-escrow'
import { safeErrorMessage } from '@/lib/safe-error'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * POST /api/me/community-giveaways/[id]/claim
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet) {
      const cw = normalizeSolanaWalletAddress(connectedWallet)
      const sw = normalizeSolanaWalletAddress(session.wallet)
      const connectedMismatch =
        cw && sw ? cw !== sw : connectedWallet !== session.wallet.trim()
      if (connectedMismatch) {
        return NextResponse.json(
          { error: 'Connected wallet does not match session. Please sign in again.' },
          { status: 401 }
        )
      }
    }

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const g = await getCommunityGiveawayById(id)
    if (!g) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 })
    }

    const sessionWallet = session.wallet.trim()
    const winner = (g.winner_wallet || '').trim()
    const winnerNorm = normalizeSolanaWalletAddress(winner)
    const sessionNorm = normalizeSolanaWalletAddress(sessionWallet)
    const winnerOk =
      winner &&
      (winnerNorm && sessionNorm ? winnerNorm === sessionNorm : winner === sessionWallet)
    if (!winnerOk) {
      return NextResponse.json({ error: 'Only the drawn winner can claim this giveaway' }, { status: 403 })
    }
    if (g.status !== 'drawn') {
      return NextResponse.json({ error: 'Winner has not been drawn yet' }, { status: 400 })
    }

    if (g.claim_tx_signature) {
      return NextResponse.json({
        success: true,
        alreadyClaimed: true,
        transactionSignature: g.claim_tx_signature,
      })
    }

    if (!g.prize_deposited_at) {
      return NextResponse.json(
        { error: 'Giveaway is not ready yet (deposit not verified by admin)' },
        { status: 400 }
      )
    }

    const stillThere = await checkEscrowHoldsNft(communityGiveawayToEscrowProbe(g))
    if (!stillThere.holds) {
      return NextResponse.json(
        {
          error:
            stillThere.error ??
            'NFT is no longer in escrow. Contact support if you already received it.',
        },
        { status: 400 }
      )
    }

    const { acquired } = await acquireCommunityGiveawayClaimLock(id, sessionWallet)
    if (!acquired) {
      return NextResponse.json(
        { error: 'Claim is in progress. Please try again in a moment.' },
        { status: 423 }
      )
    }

    const transferResult = await payoutNftPrizeFromEscrowToRecipient(
      communityGiveawayToEscrowProbe(g),
      sessionWallet
    )

    if (!transferResult.ok || !transferResult.signature) {
      await clearCommunityGiveawayClaimLock(id).catch(() => {})
      return NextResponse.json(
        { error: transferResult.error || 'Failed to transfer NFT' },
        { status: 400 }
      )
    }

    const saved = await markCommunityGiveawayClaimed(id, transferResult.signature)
    if (!saved) {
      await clearCommunityGiveawayClaimLock(id).catch(() => {})
      return NextResponse.json(
        {
          error:
            'Transfer succeeded but saving failed. Contact support with this signature: ' +
            transferResult.signature,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      transactionSignature: transferResult.signature,
    })
  } catch (error) {
    console.error('[me/community-giveaways claim]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
