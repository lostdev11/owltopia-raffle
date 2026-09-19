import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'
import { autoRefundTicketEntriesSweep } from '@/lib/raffles/auto-ticket-refunds'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/cron/auto-ticket-refunds
 * Sweep oldest unrefunded funds-escrow ticket entries on failed/cancelled raffles.
 * Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  try {
    const result = await autoRefundTicketEntriesSweep({ limit: 30, source: 'auto_cron' })
    return NextResponse.json({
      ok: true,
      ...result,
      errors: result.errors.slice(0, 10),
    })
  } catch (error) {
    console.error('[cron/auto-ticket-refunds]', error)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
