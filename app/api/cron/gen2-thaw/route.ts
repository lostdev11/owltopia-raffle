import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'

import { processGen2ThawBatch } from '@/lib/owl-center/gen2-thaw-ops'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/cron/gen2-thaw
 * Batched Candy Machine freezeSolPayment thaw after Gen2 mint-out.
 * Secured by CRON_SECRET (Bearer token).
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  try {
    const result = await processGen2ThawBatch()
    if (!result.ok) {
      return NextResponse.json(result, { status: 500 })
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('gen2-thaw cron', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
