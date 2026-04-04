import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import {
  getRafflesByCreator,
  getCreatorRevenueByWallet,
  getCreatorLiveEarningsByWallet,
  getCreatorTicketSalesGrossByWallet,
  getLiveFundsEscrowSalesBreakdownByWallet,
} from '@/lib/db/raffles'
import { getEntriesByWallet, getRefundCandidatesByRaffleIds } from '@/lib/db/entries'
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
    const [
      raffles,
      entriesWithRaffles,
      settledRevenue,
      liveEarnings,
      grossSales,
      liveFundsEscrowBreakdown,
      feeTier,
      profiles,
    ] = await Promise.all([
      getRafflesByCreator(wallet),
      getEntriesByWallet(wallet),
      getCreatorRevenueByWallet(wallet),
      getCreatorLiveEarningsByWallet(wallet),
      getCreatorTicketSalesGrossByWallet(wallet),
      getLiveFundsEscrowSalesBreakdownByWallet(wallet),
      getCreatorFeeTier(wallet, { skipCache: true, listDisplayOnly: false }), // full holder check (3% vs 6%) for dashboard
      getDisplayNamesByWallets([wallet]),
    ])

    // Earned = completed settlement totals (net) + live raffles (creator share after platform fee).
    const creatorRevenueByCurrency: Record<string, number> = {}
    for (const [cur, amt] of Object.entries(settledRevenue.byCurrency)) {
      creatorRevenueByCurrency[cur] = (creatorRevenueByCurrency[cur] ?? 0) + amt
    }
    for (const [cur, amt] of Object.entries(liveEarnings.byCurrency)) {
      creatorRevenueByCurrency[cur] = (creatorRevenueByCurrency[cur] ?? 0) + amt
    }
    const creatorRevenueTotal = Object.values(creatorRevenueByCurrency).reduce((a, b) => a + b, 0)

    const refundEligibleRaffles = raffles.filter(
      (r) => r.status === 'failed_refund_available' || r.status === 'pending_min_not_met'
    )
    const refundCandidatesByRaffle = await getRefundCandidatesByRaffleIds(
      refundEligibleRaffles.map((r) => r.id)
    )
    const creatorRefundRaffles = refundEligibleRaffles.map((r) => {
      const candidates = refundCandidatesByRaffle[r.id] ?? []
      const totalPending = candidates.reduce((sum, c) => sum + c.pendingAmount, 0)
      return {
        raffleId: r.id,
        raffleSlug: r.slug,
        raffleTitle: r.title,
        currency: r.currency,
        candidates,
        totalPending,
      }
    })

    return NextResponse.json({
      wallet,
      displayName: profiles[wallet] ?? null,
      myRaffles: raffles,
      myEntries: entriesWithRaffles,
      creatorRevenue: creatorRevenueTotal,
      creatorRevenueByCurrency,
      creatorLiveEarningsByCurrency: liveEarnings.byCurrency,
      creatorAllTimeGrossByCurrency: grossSales.byCurrency,
      claimTrackerLiveFundsEscrowSales: {
        netByCurrency: liveFundsEscrowBreakdown.netByCurrency,
        feeByCurrency: liveFundsEscrowBreakdown.feeByCurrency,
        grossByCurrency: liveFundsEscrowBreakdown.grossByCurrency,
        trackedRaffleIds: liveFundsEscrowBreakdown.trackedRaffleIds,
      },
      creatorRefundRaffles,
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
