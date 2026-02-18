import { NextRequest, NextResponse } from 'next/server'
import { createEntry } from '@/lib/db/entries'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import { isOwlEnabled, getTokenInfo } from '@/lib/tokens'
import { entriesCreateBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

// Single generic error for all failures — no signal to attackers (rate limit, state, etc.)
const ERROR_BODY = { success: false as const, error: 'server error' }

/**
 * Create a new entry (pending) and return payment details for transaction generation.
 * Responses are minimal and non-informative to prevent exploit reconnaissance.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`entries-create:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        ERROR_BODY,
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    let body: unknown
    try {
      const text = await request.text()
      if (!text?.trim()) {
        return NextResponse.json(ERROR_BODY, { status: 400 })
      }
      body = JSON.parse(text) as unknown
    } catch {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    const parsed = parseOr400(entriesCreateBody, body)
    if (!parsed.ok) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    const { raffleId: raffleIdStr, walletAddress: walletAddressStr, ticketQuantity: ticketQuantityNum } = parsed.data

    const walletRl = rateLimit(`entries-create:wallet:${walletAddressStr}`, 10, 60_000)
    if (!walletRl.allowed) {
      return NextResponse.json(
        ERROR_BODY,
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const raffle = await getRaffleById(raffleIdStr)
    if (!raffle) {
      return NextResponse.json(ERROR_BODY, { status: 404 })
    }

    if (!raffle.is_active) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    if (new Date(raffle.end_time) <= new Date()) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    if (raffle.currency === 'OWL' && !isOwlEnabled()) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[entries/create] OWL raffle checkout blocked: NEXT_PUBLIC_OWL_MINT_ADDRESS not set')
      }
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    if (raffle.max_tickets) {
      const allEntries = await getEntriesByRaffleId(raffle.id)
      const totalConfirmedTickets = allEntries
        .filter(e => e.status === 'confirmed')
        .reduce((sum, e) => sum + e.ticket_quantity, 0)
      
      if (totalConfirmedTickets + ticketQuantityNum > raffle.max_tickets) {
        return NextResponse.json(ERROR_BODY, { status: 400 })
      }
    }

    const finalAmountPaid = Number(raffle.ticket_price) * ticketQuantityNum
    if (!Number.isFinite(finalAmountPaid) || finalAmountPaid <= 0) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
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
      return NextResponse.json(ERROR_BODY, { status: 500 })
    }

    const recipientWallet = process.env.RAFFLE_RECIPIENT_WALLET || process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET
    if (!recipientWallet) {
      return NextResponse.json(ERROR_BODY, { status: 500 })
    }

    const tokenInfo = getTokenInfo(raffle.currency as 'SOL' | 'USDC' | 'OWL')

    // Minimal success: entry id for verify step + only payment details needed to build tx
    return NextResponse.json({
      success: true,
      entryId: entry.id,
      paymentDetails: {
        recipient: recipientWallet,
        amount: finalAmountPaid,
        currency: raffle.currency,
        usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        owlMint: tokenInfo.mintAddress,
        tokenDecimals: tokenInfo.decimals,
      },
    })
  } catch (error) {
    console.error('Error creating entry:', error)
    return NextResponse.json(ERROR_BODY, { status: 500 })
  }
}
