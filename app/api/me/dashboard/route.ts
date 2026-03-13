import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getRafflesByCreator, getCreatorRevenueByWallet } from '@/lib/db/raffles'
import { getEntriesByWallet } from '@/lib/db/entries'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { getDisplayNamesByWallets } from '@/lib/db/wallet-profiles'

export const dynamic = 'force-dynamic'

/**
 * GET /api/me/dashboard
 * Returns dashboard data for the signed-in wallet: my raffles, my entries, creator revenue, fee tier, display name.
 * Requires session (any connected + signed-in wallet).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const wallet = session.wallet
    const [raffles, entriesWithRaffles, revenue, feeTier, profiles] = await Promise.all([
      getRafflesByCreator(wallet),
      getEntriesByWallet(wallet),
      getCreatorRevenueByWallet(wallet),
      getCreatorFeeTier(wallet),
      getDisplayNamesByWallets([wallet]),
    ])

    return NextResponse.json({
      wallet,
      displayName: profiles[wallet] ?? null,
      myRaffles: raffles,
      myEntries: entriesWithRaffles,
      creatorRevenue: revenue.totalCreatorRevenue,
      creatorRevenueByCurrency: revenue.byCurrency,
      feeTier: { feeBps: feeTier.feeBps, reason: feeTier.reason },
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: 'Failed to load dashboard' },
      { status: 500 }
    )
  }
}
