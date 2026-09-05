import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { getWalletTicketCreditBalance } from '@/lib/packs/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/packs/credits?wallet=
 * Legacy balance lookup. New OWL pack wins no longer grant free raffle ticket credits
 * (OWL is paid to the wallet). Redeem is discontinued (410 on POST .../redeem).
 */
export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get('wallet')?.trim() || ''
    try {
      new PublicKey(wallet)
    } catch {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }
    const balance = await getWalletTicketCreditBalance(wallet)
    return NextResponse.json({
      wallet,
      freeTicketCredits: balance,
      redeemAvailable: false,
    })
  } catch (e) {
    console.error('[packs] credits GET', e)
    return NextResponse.json({ error: 'Failed to load credits' }, { status: 500 })
  }
}
