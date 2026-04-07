import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getCommunityGiveawayById, updateCommunityGiveaway } from '@/lib/db/community-giveaways'
import {
  assertEscrowSplPrizeNotFrozen,
  checkEscrowHoldsNft,
  getEscrowTokenAccountForMint,
  getPrizeEscrowPublicKey,
} from '@/lib/raffles/prize-escrow'
import { communityGiveawayToEscrowProbe } from '@/lib/giveaways/payout-nft-giveaway'
import { getMintFromDepositTx } from '@/lib/solana/parse-deposit-tx'
import { getSolanaConnection } from '@/lib/solana/connection'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/community-giveaways/[id]/verify-deposit
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const depositTx = typeof body.deposit_tx === 'string' ? body.deposit_tx.trim() : null

    const g = await getCommunityGiveawayById(id)
    if (!g) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 })
    }
    if (g.claimed_at) {
      return NextResponse.json({ error: 'Giveaway already claimed' }, { status: 400 })
    }
    if (g.prize_deposited_at) {
      return NextResponse.json({
        success: true,
        alreadyVerified: true,
        prizeDepositedAt: g.prize_deposited_at,
      })
    }

    const escrowAddress = getPrizeEscrowPublicKey()
    if (!escrowAddress) {
      return NextResponse.json({ error: 'Prize escrow not configured' }, { status: 503 })
    }

    if (depositTx) {
      const connection = getSolanaConnection()
      const mintFromTx = await getMintFromDepositTx(connection, depositTx, escrowAddress)
      if (mintFromTx && mintFromTx !== g.nft_mint_address.trim()) {
        return NextResponse.json(
          {
            error:
              'Deposit transaction mint does not match this giveaway mint. Fix the giveaway mint or use the correct transaction.',
          },
          { status: 400 }
        )
      }
    }

    const hold = await checkEscrowHoldsNft(communityGiveawayToEscrowProbe(g))
    if (!hold.holds) {
      return NextResponse.json(
        { error: hold.error ?? 'NFT is not in the prize escrow yet' },
        { status: 400 }
      )
    }

    try {
      const mintPk = new PublicKey(g.nft_mint_address.trim())
      const ata = await getEscrowTokenAccountForMint(mintPk)
      if (ata) {
        const frozen = await assertEscrowSplPrizeNotFrozen(mintPk)
        if (frozen.blocked) {
          return NextResponse.json(
            { error: frozen.error, frozenEscrowDiagnostics: frozen.diagnostics },
            { status: 400 }
          )
        }
      }
    } catch {
      // Invalid mint or not SPL — skip frozen probe
    }

    const now = new Date().toISOString()
    const updated = await updateCommunityGiveaway(id, {
      prize_deposited_at: now,
      deposit_tx_signature: depositTx ?? g.deposit_tx_signature,
    })
    if (!updated) {
      return NextResponse.json({ error: 'Failed to save verification' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      prizeDepositedAt: now,
      giveaway: updated,
    })
  } catch (error) {
    console.error('[admin/community-giveaways verify-deposit]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
