import { NextResponse } from 'next/server'
import { getOwlNest365PublicStats } from '@/lib/nesting/owl-nest-365-stats'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nesting/owl-nest-365-stats
 * Public aggregate: how many Owl Nest NFT slots are in use vs the 365 capacity (all wallets).
 */
export async function GET() {
  try {
    const stats = await getOwlNest365PublicStats()
    if (!stats) {
      return NextResponse.json({ error: 'Owl Nest 365 perch is not configured.' }, { status: 404 })
    }
    return NextResponse.json(stats)
  } catch (e) {
    console.error('[nesting/owl-nest-365-stats]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
