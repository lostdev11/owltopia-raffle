import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { assertPacksAccess } from '@/lib/packs/assert-access'
import { isPackPaymentCurrency } from '@/lib/packs/config'
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
      new PublicKey(wallet)
    } catch {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }

    const currencyRaw =
      typeof body.currency === 'string'
        ? body.currency.trim().toUpperCase()
        : typeof body.paymentCurrency === 'string'
          ? body.paymentCurrency.trim().toUpperCase()
          : 'SOL'
    if (!isPackPaymentCurrency(currencyRaw)) {
      return NextResponse.json({ error: 'currency must be SOL or OWL' }, { status: 400 })
    }

    const access = await assertPacksAccess(wallet)
    if (access !== true) return access

    const started = await startPackOpen(wallet, { currency: currencyRaw })
    return NextResponse.json({
      openId: started.openId,
      priceSol: started.priceSol,
      vault: started.vault,
      currency: started.currency,
      priceOwl: started.priceOwl ?? null,
      feeLamports: started.feeLamports ?? null,
      feeSol: started.feeSol ?? null,
      solUsdPrice: started.solUsdPrice ?? null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to start pack open'
    console.error('[packs] create', e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
