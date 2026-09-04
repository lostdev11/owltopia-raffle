import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { requireSession } from '@/lib/auth-server'
import { assertPacksAccess } from '@/lib/packs/assert-access'
import { consumePackTicketCredits, getWalletTicketCreditBalance } from '@/lib/packs/db'
import { getRaffleById } from '@/lib/db/raffles'
import { createEntry } from '@/lib/db/entries'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeRaffleTicketCurrency } from '@/lib/raffle-profit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/packs/credits/redeem
 * Spend pack free-ticket credits as confirmed raffle entries (amount_paid 0).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`packs-redeem:ip:${ip}`, 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const raffleId = typeof body.raffleId === 'string' ? body.raffleId.trim() : ''
    const tickets = Number(body.tickets)
    if (!raffleId || !Number.isInteger(tickets) || tickets < 1 || tickets > 100) {
      return NextResponse.json(
        { error: 'raffleId and tickets (1–100) are required' },
        { status: 400 }
      )
    }

    const wallet = session.wallet
    try {
       
      new PublicKey(wallet)
    } catch {
      return NextResponse.json({ error: 'Invalid session wallet' }, { status: 400 })
    }

    const access = await assertPacksAccess(wallet)
    if (access !== true) return access

    const balance = await getWalletTicketCreditBalance(wallet)
    if (balance < tickets) {
      return NextResponse.json(
        { error: `Insufficient free tickets (have ${balance})` },
        { status: 400 }
      )
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }
    if (raffle.status !== 'live' && raffle.status !== 'ready_to_draw') {
      return NextResponse.json({ error: 'Raffle is not accepting entries' }, { status: 400 })
    }

    const currency = normalizeRaffleTicketCurrency(raffle.currency)
    const placeholderSig = `pack-credit:${wallet.slice(0, 8)}:${raffleId.slice(0, 8)}:${Date.now()}`

    const entry = await createEntry({
      raffle_id: raffleId,
      wallet_address: wallet,
      ticket_quantity: tickets,
      transaction_signature: placeholderSig,
      status: 'pending',
      amount_paid: 0,
      currency,
      referral_complimentary: false,
    })

    if (!entry) {
      return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 })
    }

    const consumed = await consumePackTicketCredits(wallet, tickets, raffleId, entry.id)
    if (!consumed) {
      await getSupabaseAdmin().from('entries').delete().eq('id', entry.id)
      return NextResponse.json({ error: 'Failed to consume ticket credits' }, { status: 400 })
    }

    const { error: confErr } = await getSupabaseAdmin()
      .from('entries')
      .update({
        status: 'confirmed',
        verified_at: new Date().toISOString(),
        amount_paid: 0,
      })
      .eq('id', entry.id)

    if (confErr) {
      console.error('[packs] redeem confirm', confErr)
      return NextResponse.json({ error: 'Entry created but confirm failed' }, { status: 500 })
    }

    const remaining = await getWalletTicketCreditBalance(wallet)
    return NextResponse.json({
      success: true,
      entryId: entry.id,
      tickets,
      raffleId,
      freeTicketCreditsRemaining: remaining,
    })
  } catch (e) {
    console.error('[packs] redeem', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Redeem failed' },
      { status: 500 }
    )
  }
}
