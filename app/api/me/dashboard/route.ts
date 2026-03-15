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
const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const wallet = session.wallet
    const [raffles, entriesWithRaffles, revenue, feeTier, profiles] = await Promise.all([
      getRafflesByCreator(wallet),
      getEntriesByWallet(wallet),
      getCreatorRevenueByWallet(wallet),
      getCreatorFeeTier(wallet, { skipCache: true }), // always verify holder status when loading dashboard
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
