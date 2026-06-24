import { NextRequest, NextResponse } from 'next/server'

import { repriceGen2GuardIfDrifted } from '@/lib/owl-center/gen2-guard-reprice'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/gen2-reprice-guard
 * Vercel Cron: re-pegs the Owltopia Gen2 Candy Machine `solPayment` guard (WL / public
 * groups) to their fixed USD targets using the live SOL/USD price, so the on-chain SOL
 * charge tracks the dollar price as SOL moves. Safe no-op until the CM is deployed and the
 * guard-authority key (GEN2_GUARD_AUTHORITY_SECRET_KEY) is set. Secured by CRON_SECRET.
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
    const result = await repriceGen2GuardIfDrifted()
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('gen2-reprice-guard cron', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
