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
import { defaultDisplayNameFromWallet, getWalletProfileForDashboard } from '@/lib/db/wallet-profiles'
import {
  getEmptyEngagementPayload,
  syncEngagementMilestonesAndGetPayload,
} from '@/lib/db/wallet-milestones'
import { getReferralSummaryForWallet, syncReferralStateForWallet } from '@/lib/db/referrals'
import { listCommunityGiveawaysWonByWallet } from '@/lib/db/community-giveaways'
import { listNftGiveawaysForWallet } from '@/lib/db/nft-giveaways'
import {
  expireStaleBuyoutOffersForBidderWallet,
  listBuyoutOffersForBidder,
} from '@/lib/db/buyout-offers'
import { processEndedRaffleByIdIfApplicable } from '@/lib/draw-ended-raffles'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import { listOfferRefundCandidatesByWallet } from '@/lib/db/raffle-offers'
import { getDiscordPartnerTenantIdForCreatorWallet } from '@/lib/db/partner-community-creators-admin'

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

    try {
      await expireStaleBuyoutOffersForBidderWallet(wallet)
    } catch (e) {
      console.warn('[me/dashboard] buyout expire stale:', e instanceof Error ? e.message : e)
    }

    try {
      await syncReferralStateForWallet(wallet)
    } catch (e) {
      console.error('[me/dashboard] referral sync:', e instanceof Error ? e.message : e)
    }

    let entriesWithRaffles = await getEntriesByWallet(wallet)
    const endedNoWinnerCandidateIds = new Set<string>()
    for (const row of entriesWithRaffles) {
      const r = row.raffle
      if (!r?.id) continue
      if ((r.winner_wallet && String(r.winner_wallet).trim()) || (r.winner_selected_at && String(r.winner_selected_at).trim())) continue
      if (r.status !== 'live' && r.status !== 'ready_to_draw' && r.status !== 'pending_min_not_met') {
        continue
      }
      const endMs = new Date(r.end_time).getTime()
      if (Number.isNaN(endMs) || endMs > Date.now()) continue
      const partnerFungible = isPartnerSplPrizeRaffle(r)
      if ((r.prize_type === 'nft' || partnerFungible) && !r.prize_deposited_at) continue
      endedNoWinnerCandidateIds.add(r.id)
    }
    if (endedNoWinnerCandidateIds.size > 0) {
      for (const raffleId of endedNoWinnerCandidateIds) {
        await processEndedRaffleByIdIfApplicable(raffleId)
      }
      entriesWithRaffles = await getEntriesByWallet(wallet)
    }

    const [
      raffles,
      settledRevenue,
      liveEarnings,
      grossSales,
      liveFundsEscrowBreakdown,
      feeTier,
      walletProfile,
      nftGiveaways,
      communityGiveaways,
      referralSummary,
      offerRefundCandidates,
      partnerDiscordTenantId,
      buyoutOffers,
    ] = await Promise.all([
      getRafflesByCreator(wallet),
      getCreatorRevenueByWallet(wallet),
      getCreatorLiveEarningsByWallet(wallet),
      getCreatorTicketSalesGrossByWallet(wallet),
      getLiveFundsEscrowSalesBreakdownByWallet(wallet),
      getCreatorFeeTier(wallet, { skipCache: true, listDisplayOnly: false }), // full holder check (3% vs 6%) for dashboard
      getWalletProfileForDashboard(wallet),
      listNftGiveawaysForWallet(wallet).catch((err) => {
        console.error('listNftGiveawaysForWallet:', err)
        return []
      }),
      listCommunityGiveawaysWonByWallet(wallet).catch((err) => {
        console.error('listCommunityGiveawaysWonByWallet:', err)
        return []
      }),
      getReferralSummaryForWallet(wallet).catch((err) => {
        console.error('getReferralSummaryForWallet:', err)
        return null
      }),
      listOfferRefundCandidatesByWallet(wallet).catch((err) => {
        console.error('listOfferRefundCandidatesByWallet:', err)
        return []
      }),
      getDiscordPartnerTenantIdForCreatorWallet(wallet).catch((err) => {
        console.error('getDiscordPartnerTenantIdForCreatorWallet:', err)
        return null as string | null
      }),
      listBuyoutOffersForBidder(wallet).catch((err) => {
        console.error('listBuyoutOffersForBidder:', err)
        return []
      }),
    ])

    /** Custom referral codes require Owltopia holder fee tier (partners use partner tier only; no extra DAS check). */
    const canSetVanityReferral = feeTier.reason === 'holder'

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
      (r) =>
        r.status === 'failed_refund_available' ||
        r.status === 'pending_min_not_met' ||
        r.status === 'cancelled'
    )
    const refundCandidatesByRaffle = await getRefundCandidatesByRaffleIds(
      refundEligibleRaffles.map((r) => r.id)
    )

    const confirmedRows = entriesWithRaffles.filter((row) => row.entry.status === 'confirmed')
    const uniqueConfirmedRaffleIds = new Set(
      confirmedRows
        .map((row) => row.raffle?.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    )
    const confirmedTicketQuantitySum = confirmedRows.reduce(
      (sum, row) => sum + (Number(row.entry.ticket_quantity) || 0),
      0
    )
    const displayTrim = walletProfile.displayName?.trim() ?? null
    const customDisplayName =
      displayTrim != null &&
      displayTrim.length > 0 &&
      displayTrim !== defaultDisplayNameFromWallet(wallet)

    let engagement = getEmptyEngagementPayload()
    try {
      engagement = await syncEngagementMilestonesAndGetPayload(wallet, {
        customDisplayName,
        discordLinked: walletProfile.discord.linked,
        uniqueConfirmedRaffleCount: uniqueConfirmedRaffleIds.size,
        confirmedTicketQuantitySum,
        hostedRaffleCount: raffles.length,
      })
    } catch (e) {
      console.error('[me/dashboard] engagement milestones:', e instanceof Error ? e.message : e)
      engagement = getEmptyEngagementPayload()
    }

    const creatorRefundRaffles = refundEligibleRaffles
      .map((r) => {
        const candidates = refundCandidatesByRaffle[r.id] ?? []
        const totalPending = candidates.reduce((sum, c) => sum + c.pendingAmount, 0)
        return {
          raffleId: r.id,
          raffleSlug: r.slug,
          raffleTitle: r.title,
          currency: r.currency,
          candidates,
          totalPending,
          /** False = legacy split-at-purchase; host must send refunds manually. True = funds escrow; buyers self-claim. */
          ticketPaymentsToFundsEscrow: raffleUsesFundsEscrow(r),
        }
      })
      /** Hide creator refund UI once every confirmed ticket row is refunded (e.g. after platform escrow payouts). */
      .filter((rr) => rr.totalPending > 0)

    return NextResponse.json({
      wallet,
      displayName: walletProfile.displayName,
      discord: walletProfile.discord,
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
      offerRefundCandidates,
      feeTier: { feeBps: feeTier.feeBps, reason: feeTier.reason },
      /** Linked Discord partner tenant (Owl Vision); used for partner raffle webhooks. */
      partnerDiscordTenantId,
      nftGiveaways,
      communityGiveaways,
      referral:
        referralSummary != null
          ? { ...referralSummary, canSetVanity: canSetVanityReferral }
          : null,
      buyoutOffers,
      engagement,
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
