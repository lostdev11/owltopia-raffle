import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getClaimsStats } from '@/lib/admin/claims-stats'
import { safeErrorMessage, safeErrorDetails } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/claims-stats
 * Tier 1+2 Gen Owl rev share + OWL nest reward claim analytics.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const payload = await getClaimsStats()
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Error in claims-stats:', error)
    return NextResponse.json(
      {
        error: safeErrorMessage(error),
        ...(safeErrorDetails(error) && { details: safeErrorDetails(error) }),
      },
      { status: 500 }
    )
  }
}
