import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'

import { repriceGen2GuardIfDrifted } from '@/lib/owl-center/gen2-guard-reprice'
import { isGen2PublicMintRetired } from '@/lib/owl-center/mint-policy'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/gen2-reprice-guard
 * Soft-retired while Gen2 mint is sold out. Route kept if GEN2_PUBLIC_MINT_ENABLED=true.
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  if (isGen2PublicMintRetired()) {
    return NextResponse.json({
      ok: true,
      status: 'skipped',
      reason: 'gen2_mint_retired',
    })
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
