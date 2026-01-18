import { NextRequest, NextResponse } from 'next/server'
import { createEntry } from '@/lib/db/entries'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

/**
 * Create a new entry (pending) and return payment details for transaction generation
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { raffleId, walletAddress, ticketQuantity, amountPaid } = body

    if (!raffleId || !walletAddress || !ticketQuantity) {
      return NextResponse.json(
        { error: 'Missing required fields: raffleId, walletAddress, ticketQuantity' },
        { status: 400 }
      )
    }

    // Get the raffle
    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    // Check if raffle is active
    if (!raffle.is_active) {
      return NextResponse.json(
        { error: 'Raffle is not active' },
        { status: 400 }
      )
    }

    // Check if raffle has ended
    if (new Date(raffle.end_time) <= new Date()) {
      return NextResponse.json(
        { error: 'Raffle has ended' },
        { status: 400 }
      )
    }

    // Check max_tickets limit if set
    if (raffle.max_tickets) {
      const allEntries = await getEntriesByRaffleId(raffle.id)
      const totalConfirmedTickets = allEntries
        .filter(e => e.status === 'confirmed')
        .reduce((sum, e) => sum + e.ticket_quantity, 0)
      
      if (totalConfirmedTickets + ticketQuantity > raffle.max_tickets) {
        return NextResponse.json(
          { error: `Cannot purchase ${ticketQuantity} tickets: would exceed maximum ticket limit of ${raffle.max_tickets}. Only ${raffle.max_tickets - totalConfirmedTickets} tickets remaining.` },
          { status: 400 }
        )
      }
    }

    // Use provided amountPaid if available, otherwise calculate from ticket_price * ticketQuantity
    const finalAmountPaid = amountPaid !== undefined && amountPaid !== null ? amountPaid : raffle.ticket_price * ticketQuantity
    
    // Log calculation for debugging
    console.log(`Payment calculation: ticket_price=${raffle.ticket_price}, ticketQuantity=${ticketQuantity}, providedAmountPaid=${amountPaid}, finalAmountPaid=${finalAmountPaid}`)

    // Create pending entry
    const entry = await createEntry({
      raffle_id: raffleId,
      wallet_address: walletAddress,
      ticket_quantity: ticketQuantity,
      transaction_signature: null,
      status: 'pending',
      amount_paid: finalAmountPaid,
      currency: raffle.currency,
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Failed to create entry' },
        { status: 500 }
      )
    }

    // Get recipient wallet address from environment variable
    // This should be the wallet that receives payments
    const recipientWallet = process.env.RAFFLE_RECIPIENT_WALLET || process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET

    if (!recipientWallet) {
      return NextResponse.json(
        { error: 'Recipient wallet not configured. Please set RAFFLE_RECIPIENT_WALLET environment variable.' },
        { status: 500 }
      )
    }

    // Return entry and payment details for transaction generation
    return NextResponse.json({
      entry,
      paymentDetails: {
        recipient: recipientWallet,
        amount: finalAmountPaid,
        currency: raffle.currency,
        // USDC mint address on Solana mainnet
        usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      },
    })
  } catch (error) {
    console.error('Error creating entry:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
