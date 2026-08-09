import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { confirmAndOpenPack } from '@/lib/packs/open-engine'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`packs-open:ip:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const openId = typeof body.openId === 'string' ? body.openId.trim() : ''
    const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : ''
    const paymentSignature =
      typeof body.paymentSignature === 'string' ? body.paymentSignature.trim() : ''

    if (!openId || !wallet || !paymentSignature) {
      return NextResponse.json(
        { error: 'openId, wallet, and paymentSignature are required' },
        { status: 400 }
      )
    }
    try {
      // eslint-disable-next-line no-new
      new PublicKey(wallet)
    } catch {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }

    const result = await confirmAndOpenPack({
      openId,
      buyerWallet: wallet,
      paymentSignature,
    })

    return NextResponse.json({
      success: true,
      result: {
        ...result,
        revealMessage:
          result.category === 'owl'
            ? `You have won ${result.freeTicketCredits} free tickets on raffle site`
            : `You won ${result.prizeLabel}`,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Pack open failed'
    console.error('[packs] open', e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
