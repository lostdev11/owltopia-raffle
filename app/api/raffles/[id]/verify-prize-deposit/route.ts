import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { checkEscrowHoldsNft, getPrizeEscrowPublicKey } from '@/lib/raffles/prize-escrow'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/verify-prize-deposit
 * Verifies that the NFT prize is in the platform escrow and sets prize_deposited_at.
 * Call after the creator has sent the NFT to the prize escrow address.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }
    if (raffle.prize_type !== 'nft') {
      return NextResponse.json(
        { error: 'This raffle does not have an NFT prize' },
        { status: 400 }
      )
    }
    if (raffle.prize_deposited_at) {
      return NextResponse.json({
        success: true,
        alreadyVerified: true,
        prizeDepositedAt: raffle.prize_deposited_at,
      })
    }

    const { holds, error: checkError } = await checkEscrowHoldsNft(raffle)
    if (checkError) {
      return NextResponse.json(
        { error: `Could not verify escrow: ${checkError}` },
        { status: 502 }
      )
    }
    if (!holds) {
      return NextResponse.json(
        {
          error:
            'NFT not found in prize escrow. Send the NFT to the prize escrow address and try again.',
          prizeEscrowAddress: getPrizeEscrowPublicKey(),
        },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    await updateRaffle(id, { prize_deposited_at: now, is_active: true })
    return NextResponse.json({
      success: true,
      prizeDepositedAt: now,
    })
  } catch (error) {
    console.error('Verify prize deposit error:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
