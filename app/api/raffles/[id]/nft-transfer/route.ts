import { NextRequest, NextResponse } from 'next/server'
import { updateRaffle, getRaffleById } from '@/lib/db/raffles'
import { requireAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'

// Force dynamic rendering since we use request body and params
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/raffles/[id]/nft-transfer
 * Updates the NFT transfer transaction signature for a raffle. Admin only (session required).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json()
    const params = await context.params
    const raffleId = params.id
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }
    const { transaction_signature } = body

    // Validate transaction signature
    if (!transaction_signature || typeof transaction_signature !== 'string') {
      return NextResponse.json(
        { error: 'Transaction signature is required' },
        { status: 400 }
      )
    }

    // Check if raffle exists
    const existingRaffle = await getRaffleById(raffleId)
    if (!existingRaffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    // Verify this is an NFT raffle
    if (existingRaffle.prize_type !== 'nft') {
      return NextResponse.json(
        { error: 'This raffle does not have an NFT prize' },
        { status: 400 }
      )
    }

    // Verify raffle has a winner
    if (!existingRaffle.winner_wallet) {
      return NextResponse.json(
        { error: 'Raffle must have a winner before recording NFT transfer' },
        { status: 400 }
      )
    }

    // Update the raffle with the NFT transfer transaction signature
    const raffle = await updateRaffle(raffleId, {
      nft_transfer_transaction: transaction_signature,
    })

    if (!raffle) {
      return NextResponse.json(
        { error: 'Failed to update raffle' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      raffle,
      message: 'NFT transfer transaction recorded successfully',
    })
  } catch (error) {
    console.error('Error updating NFT transfer transaction:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
