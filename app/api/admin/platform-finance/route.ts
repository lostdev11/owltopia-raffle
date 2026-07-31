import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getPlatformFinance } from '@/lib/admin/platform-finance'
import { safeErrorMessage, safeErrorDetails } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/platform-finance
 * Settlement fees (accrued vs collected), cancellation fees, ticket volume, rev-share cashflow.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const payload = await getPlatformFinance()
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Error in platform-finance:', error)
    return NextResponse.json(
      {
        error: safeErrorMessage(error),
        ...(safeErrorDetails(error) && { details: safeErrorDetails(error) }),
      },
      { status: 500 }
    )
  }
}
