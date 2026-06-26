import { NextRequest, NextResponse } from 'next/server'

import { sweepGen2MintProceeds } from '@/lib/owl-center/gen2-mint-proceeds-split'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/gen2-treasury-split
 * Vercel Cron: sweeps the enforced Gen2 mint proceeds from the single distribution wallet
 * (the candy-guard `solPayment` destination) to the founder split wallets 50/50, per
 * `mint_fund_splits`. Safe no-op until `GEN2_MINT_PROCEEDS_SECRET_KEY` is set and the wallet has
 * a distributable balance above the reserve + threshold. Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET is not set')
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'server error' }, { status: 401 })
  }

  try {
    const result = await sweepGen2MintProceeds()
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('gen2-treasury-split cron', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
