import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'
import { refreshStaleLiveRaffleMarketFloors } from '@/lib/raffles/refresh-market-floors'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/refresh-raffle-market-floors
 * Refreshes marketplace floor snapshots for live NFT raffles (display only).
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  try {
    const { processed, results } = await refreshStaleLiveRaffleMarketFloors()
    const refreshed = results.filter((r) => r.refreshed).length
    const errors = results.filter((r) => r.error).length
    return NextResponse.json({
      ok: true,
      processed,
      refreshed,
      errors,
      results,
    })
  } catch (e) {
    console.error('refresh-raffle-market-floors cron:', e)
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
