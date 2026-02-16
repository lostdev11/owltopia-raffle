import { NextRequest, NextResponse } from 'next/server'
import { createEntry } from '@/lib/db/entries'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import { isOwlEnabled, getTokenInfo } from '@/lib/tokens'
import { entriesCreateBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/safe-error'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

/**
 * Create a new entry (pending) and return payment details for transaction generation
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`entries-create:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    let body: unknown
    try {
      const text = await request.text()
      if (!text?.trim()) {
        return NextResponse.json(
          { error: 'Request body is required (JSON with raffleId, walletAddress, ticketQuantity)' },
          { status: 400 }
        )
      }
      body = JSON.parse(text) as unknown
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }

    const parsed = parseOr400(entriesCreateBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { raffleId: raffleIdStr, walletAddress: walletAddressStr, ticketQuantity: ticketQuantityNum } = parsed.data

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

    // OWL: block checkout if mint is not configured (no on-chain transaction yet)
    if (raffle.currency === 'OWL' && !isOwlEnabled()) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[entries/create] OWL raffle checkout blocked: NEXT_PUBLIC_OWL_MINT_ADDRESS not set')
      }
      return NextResponse.json(
        { error: 'OWL entry is not enabled yet — mint address pending.' },
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

    // Always compute amount server-side from ticket_price * ticketQuantity. Never trust client-supplied amountPaid (underpayment risk).
    const finalAmountPaid = Number(raffle.ticket_price) * ticketQuantityNum
    if (!Number.isFinite(finalAmountPaid) || finalAmountPaid <= 0) {
      return NextResponse.json(
        { error: 'Invalid ticket price or quantity' },
        { status: 400 }
      )
    }

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
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
