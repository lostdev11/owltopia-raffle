import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { requireSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { safeErrorMessage } from '@/lib/safe-error'
import { verifyNftPrizeDepositCore } from '@/lib/raffles/verify-nft-prize-deposit-core'
import type { Raffle } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/verify-prize-deposit
 * Verifies that an NFT prize is in the platform escrow (discovered by what escrow holds)
 * and sets prize_deposited_at. Updates raffle nft_mint_address when escrow has exactly one NFT.
 * Optional body: { deposit_tx?: string } - when provided, parses the tx to identify which mint
 * was transferred to escrow (works even when escrow holds multiple NFTs).
 * Caller must be the raffle creator or a full admin.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const depositTx = typeof body.deposit_tx === 'string' ? body.deposit_tx.trim() : null

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }
    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const isCreator = creatorWallet && session.wallet === creatorWallet
    const isAdmin = (await getAdminRole(session.wallet)) !== null
    if (!isCreator && !isAdmin) {
      return NextResponse.json(
        { error: 'Only the raffle creator or an admin can verify the prize deposit' },
        { status: 403 }
      )
    }
    if (raffle.prize_type !== 'nft') {
      return NextResponse.json(
        { error: 'This raffle does not have an NFT prize' },
        { status: 400 }
      )
    }

    const outcome = await verifyNftPrizeDepositCore(
      {
        nft_mint_address: raffle.nft_mint_address,
        nft_token_id: raffle.nft_token_id,
        prize_standard: raffle.prize_standard ?? undefined,
      },
      depositTx,
      raffle.prize_deposited_at
    )

    if (outcome.kind === 'already_verified') {
      return NextResponse.json({
        success: true,
        alreadyVerified: true,
        prizeDepositedAt: outcome.prizeDepositedAt,
      })
    }
    if (outcome.kind === 'error') {
      return NextResponse.json({ error: outcome.message }, { status: outcome.status })
    }

    await updateRaffle(id, outcome.dbPatch as Partial<Raffle>)
    return NextResponse.json({
      success: true,
      prizeDepositedAt: outcome.prizeDepositedAt,
      nftMintAddress: outcome.nftMintAddress,
      ...(outcome.prizeDepositTx ? { prizeDepositTx: outcome.prizeDepositTx } : {}),
      ...(outcome.prizeStandard ? { prizeStandard: outcome.prizeStandard } : {}),
    })
  } catch (error) {
    console.error('Verify prize deposit error:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
