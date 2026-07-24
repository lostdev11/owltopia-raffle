import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'
import { processEndedAuctions } from '@/lib/auctions/end-auctions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** GET /api/cron/end-nft-auctions — close live auctions past ends_at. */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  try {
    const results = await processEndedAuctions()
    return NextResponse.json({
      ok: true,
      processedCount: results.length,
      results,
    })
  } catch (e) {
    console.error('end-nft-auctions cron:', e)
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
