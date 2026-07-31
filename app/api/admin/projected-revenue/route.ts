import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getPlatformFinance } from '@/lib/admin/platform-finance'
import { safeErrorMessage, safeErrorDetails } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/projected-revenue
 * @deprecated Prefer /api/admin/platform-finance. Kept as alias for older admin clients.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const finance = await getPlatformFinance()
    // Legacy shape so any stale callers still get useful fee + activity numbers
    return NextResponse.json({
      allTime: {
        usdc: finance.ticketActivity.last30Days.usdc,
        sol: finance.ticketActivity.last30Days.sol,
        owl: finance.ticketActivity.last30Days.owl,
        ticketsSold: finance.ticketActivity.last30Days.ticketsSold,
        confirmedEntries: finance.ticketActivity.last30Days.confirmedEntries,
      },
      last7Days: finance.ticketActivity.last7Days,
      last30Days: finance.ticketActivity.last30Days,
      avgPerDay7: {
        usdc: finance.ticketActivity.last7Days.usdc / 7,
        sol: finance.ticketActivity.last7Days.sol / 7,
        owl: finance.ticketActivity.last7Days.owl / 7,
        ticketsSold: finance.ticketActivity.last7Days.ticketsSold / 7,
      },
      avgPerDay30: {
        usdc: finance.ticketActivity.last30Days.usdc / 30,
        sol: finance.ticketActivity.last30Days.sol / 30,
        owl: finance.ticketActivity.last30Days.owl / 30,
        ticketsSold: finance.ticketActivity.last30Days.ticketsSold / 30,
      },
      platformFees: {
        usdc: finance.raffleSettlementFees.collected.usdc,
        sol: finance.raffleSettlementFees.collected.sol,
        owl: finance.raffleSettlementFees.collected.owl,
      },
      deprecated: true,
      redirectTo: '/api/admin/platform-finance',
      platformFinance: finance,
    })
  } catch (error) {
    console.error('Error in projected-revenue alias:', error)
    return NextResponse.json(
      {
        error: safeErrorMessage(error),
        ...(safeErrorDetails(error) && { details: safeErrorDetails(error) }),
      },
      { status: 500 }
    )
  }
}
