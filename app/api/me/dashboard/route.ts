import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import {
  getRafflesByCreator,
  getCreatorRevenueByWallet,
  getCreatorLiveRevenueByWallet,
} from '@/lib/db/raffles'
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
    const [raffles, entriesWithRaffles, settledRevenue, liveRevenue, feeTier, profiles] =
      await Promise.all([
        getRafflesByCreator(wallet),
        getEntriesByWallet(wallet),
        getCreatorRevenueByWallet(wallet),
        getCreatorLiveRevenueByWallet(wallet),
        getCreatorFeeTier(wallet, { skipCache: true }), // always verify holder status when loading dashboard
        getDisplayNamesByWallets([wallet]),
      ])

    // Merge settled + live into all-time gross by currency.
    const allTimeGrossByCurrency: Record<string, number> = {}
    for (const [cur, amt] of Object.entries(settledRevenue.byCurrency)) {
      allTimeGrossByCurrency[cur] = (allTimeGrossByCurrency[cur] ?? 0) + amt
    }
    for (const [cur, amt] of Object.entries(liveRevenue.byCurrency)) {
      allTimeGrossByCurrency[cur] = (allTimeGrossByCurrency[cur] ?? 0) + amt
    }

    return NextResponse.json({
      wallet,
      displayName: profiles[wallet] ?? null,
      myRaffles: raffles,
      myEntries: entriesWithRaffles,
      // Settled creator revenue (completed raffles).
      creatorRevenue: settledRevenue.totalCreatorRevenue,
      creatorRevenueByCurrency: settledRevenue.byCurrency,
      // Live gross revenue from active raffles (confirmed entries, before fees).
      creatorLiveRevenueByCurrency: liveRevenue.byCurrency,
      // All-time gross ticket sales (settled + live, before fees).
      creatorAllTimeGrossByCurrency: allTimeGrossByCurrency,
      feeTier: { feeBps: feeTier.feeBps, reason: feeTier.reason },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load dashboard'
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
