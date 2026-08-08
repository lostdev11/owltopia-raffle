import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { startPackOpen } from '@/lib/packs/open-engine'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`packs-create:ip:${ip}`, 40, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : ''
    try {
      // eslint-disable-next-line no-new
      new PublicKey(wallet)
    } catch {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }

    const started = await startPackOpen(wallet)
    return NextResponse.json({
      openId: started.openId,
      priceSol: started.priceSol,
      vault: started.vault,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to start pack open'
    console.error('[packs] create', e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
