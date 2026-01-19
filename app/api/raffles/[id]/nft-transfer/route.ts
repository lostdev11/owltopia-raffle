import { NextRequest, NextResponse } from 'next/server'
import { updateRaffle, getRaffleById } from '@/lib/db/raffles'
import { isAdmin } from '@/lib/db/admins'

// Force dynamic rendering since we use request body and params
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/raffles/[id]/nft-transfer
 * Updates the NFT transfer transaction signature for a raffle (admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const raffleId = params.id
    const { transaction_signature, wallet_address } = body

    // Check if wallet address is provided
    const walletAddress = wallet_address || request.headers.get('x-wallet-address')
    
    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 401 }
      )
    }

    // Check if user is an admin
    const adminStatus = await isAdmin(walletAddress)
    if (!adminStatus) {
      return NextResponse.json(
        { error: 'Only admins can update NFT transfer transactions' },
        { status: 403 }
      )
    }

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
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
