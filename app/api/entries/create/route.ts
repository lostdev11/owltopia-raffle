import { NextRequest, NextResponse } from 'next/server'
import { createEntry } from '@/lib/db/entries'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import { isOwlEnabled, getTokenInfo } from '@/lib/tokens'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

/**
 * Create a new entry (pending) and return payment details for transaction generation
 */
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>
    try {
      const text = await request.text()
      if (!text || !text.trim()) {
        return NextResponse.json(
          { error: 'Request body is required (JSON with raffleId, walletAddress, ticketQuantity)' },
          { status: 400 }
        )
      }
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }
    const { raffleId, walletAddress, ticketQuantity, amountPaid } = body

    if (!raffleId || !walletAddress || ticketQuantity == null) {
      return NextResponse.json(
        { error: 'Missing required fields: raffleId, walletAddress, ticketQuantity' },
        { status: 400 }
      )
    }

    const raffleIdStr = typeof raffleId === 'string' ? raffleId : String(raffleId)
    const walletAddressStr = typeof walletAddress === 'string' ? walletAddress : String(walletAddress)
    const ticketQuantityNum = typeof ticketQuantity === 'number' ? ticketQuantity : Number(ticketQuantity)
    if (!Number.isInteger(ticketQuantityNum) || ticketQuantityNum < 1) {
      return NextResponse.json(
        { error: 'ticketQuantity must be a positive integer' },
        { status: 400 }
      )
    }

    // Get the raffle
    const raffle = await getRaffleById(raffleIdStr)
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
      
      if (totalConfirmedTickets + ticketQuantityNum > raffle.max_tickets) {
        return NextResponse.json(
          { error: `Cannot purchase ${ticketQuantityNum} tickets: would exceed maximum ticket limit of ${raffle.max_tickets}. Only ${raffle.max_tickets - totalConfirmedTickets} tickets remaining.` },
          { status: 400 }
        )
      }
    }

    // Use provided amountPaid if available, otherwise calculate from ticket_price * ticketQuantity
    const rawAmountPaid = amountPaid !== undefined && amountPaid !== null ? amountPaid : raffle.ticket_price * ticketQuantityNum
    const finalAmountPaid = typeof rawAmountPaid === 'number' && !Number.isNaN(rawAmountPaid) ? rawAmountPaid : raffle.ticket_price * ticketQuantityNum
    
    // Log calculation for debugging
    console.log(`Payment calculation: ticket_price=${raffle.ticket_price}, ticketQuantity=${ticketQuantityNum}, providedAmountPaid=${amountPaid}, finalAmountPaid=${finalAmountPaid}`)

    // Create pending entry
    const entry = await createEntry({
      raffle_id: raffleIdStr,
      wallet_address: walletAddressStr,
      ticket_quantity: ticketQuantityNum,
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

    // Treasury/recipient wallet: same for SOL, USDC, and OWL. All ticket payments
    // (native SOL, USDC SPL, OWL SPL) are sent to this wallet for verification.
    const recipientWallet = process.env.RAFFLE_RECIPIENT_WALLET || process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET

    if (!recipientWallet) {
      return NextResponse.json(
        { error: 'Recipient wallet not configured. Please set RAFFLE_RECIPIENT_WALLET environment variable.' },
        { status: 500 }
      )
    }

    // Get token info for the raffle currency (for SPL tokens like USDC/OWL)
    const tokenInfo = getTokenInfo(raffle.currency as 'SOL' | 'USDC' | 'OWL')
    
    // Return entry and payment details for transaction generation. Client sends
    // SOL to recipient; USDC/OWL to recipient's associated token accounts (ATA).
    return NextResponse.json({
      entry,
      paymentDetails: {
        recipient: recipientWallet, // treasury for SOL, USDC, and OWL
        amount: finalAmountPaid,
        currency: raffle.currency,
        usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        owlMint: tokenInfo.mintAddress,
        tokenDecimals: tokenInfo.decimals,
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
