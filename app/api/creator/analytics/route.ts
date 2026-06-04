import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getCreatorAnalyticsForWallet } from '@/lib/db/creator-analytics'

export const dynamic = 'force-dynamic'

/**
 * GET /api/creator/analytics
 * Analytics for raffles created by the signed-in wallet.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const daysParam = request.nextUrl.searchParams.get('days')
    let days: number | null = 30
    if (daysParam === 'all') {
      days = null
    } else if (daysParam) {
      const parsed = Number(daysParam)
      if (Number.isFinite(parsed) && parsed > 0) days = parsed
    }

    const data = await getCreatorAnalyticsForWallet(session.wallet, { days })
    return NextResponse.json(data)
  } catch (e) {
    console.error('[creator/analytics]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
