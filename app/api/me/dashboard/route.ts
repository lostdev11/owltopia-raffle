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
import { getReferralSummaryForWallet, syncReferralStateForWallet, ensureWalletReferralRow } from '@/lib/db/referrals'
import {
  getReferrerMonthlyUsage,
  listPendingReferralRewardsForWallet,
} from '@/lib/db/referral-rewards'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { raffleEligibleForReferralFreeEntry } from '@/lib/referrals/program'
import { isReferralGrowthProgramActive, isReferralProgramEnabled } from '@/lib/referrals/config'
import { listCommunityGiveawaysWonByWallet } from '@/lib/db/community-giveaways'
import { listNftGiveawaysForWallet } from '@/lib/db/nft-giveaways'
import { enrichBuyoutOffersRefundDepositSource } from '@/lib/buyout/dashboard-offers'
import {
  expireStaleBuyoutOffersForBidderWallet,
  listBuyoutOffersForBidder,
} from '@/lib/db/buyout-offers'
import { processEndedRaffleByIdIfApplicable } from '@/lib/draw-ended-raffles'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import { listOfferRefundCandidatesByWallet } from '@/lib/db/raffle-offers'
import { listMilestoneBonusWinsForWallet } from '@/lib/db/raffle-milestones'
import { getDiscordPartnerTenantIdForCreatorWallet } from '@/lib/db/partner-community-creators-admin'
import { isAdmin as isWalletRegisteredAdmin } from '@/lib/db/admins'

export const dynamic = 'force-dynamic'

/** Same filters as {@link processEndedRaffleByIdIfApplicable} — used so hosts see claim UI without buying their own tickets. */
function isEndedNoWinnerProcessCandidate(
  raffle:
    | {
        id?: string
        winner_wallet?: string | null
        winner_selected_at?: string | null
        status?: string | null
        end_time?: string
        prize_type?: string | null
        prize_deposited_at?: string | null
        prize_currency?: string | null
      }
    | null
    | undefined
): raffle is { id: string } {
  if (!raffle?.id) return false
  if (
    (raffle.winner_wallet && String(raffle.winner_wallet).trim()) ||
    (raffle.winner_selected_at && String(raffle.winner_selected_at).trim())
  ) {
    return false
  }
  if (
    raffle.status !== 'live' &&
    raffle.status !== 'ready_to_draw' &&
    raffle.status !== 'pending_min_not_met'
  ) {
    return false
  }
  const endMs = new Date(raffle.end_time ?? '').getTime()
  if (Number.isNaN(endMs) || endMs > Date.now()) return false
  const partnerFungible = isPartnerSplPrizeRaffle(raffle as Parameters<typeof isPartnerSplPrizeRaffle>[0])
  if ((raffle.prize_type === 'nft' || partnerFungible) && !raffle.prize_deposited_at) return false
  return true
}

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
      await ensureWalletReferralRow(wallet)
    } catch (e) {
      console.error('[me/dashboard] referral sync:', e instanceof Error ? e.message : e)
    }

    let entriesWithRaffles = await getEntriesByWallet(wallet)
    let rafflesForResponse = await getRafflesByCreator(wallet)

    const endedNoWinnerCandidateIds = new Set<string>()
    for (const row of entriesWithRaffles) {
      const r = row.raffle
      if (isEndedNoWinnerProcessCandidate(r ?? undefined)) endedNoWinnerCandidateIds.add(r!.id)
    }
    for (const r of rafflesForResponse) {
      if (isEndedNoWinnerProcessCandidate(r)) endedNoWinnerCandidateIds.add(r.id)
    }

    if (endedNoWinnerCandidateIds.size > 0) {
      for (const raffleId of endedNoWinnerCandidateIds) {
        await processEndedRaffleByIdIfApplicable(raffleId)
      }
      entriesWithRaffles = await getEntriesByWallet(wallet)
      rafflesForResponse = await getRafflesByCreator(wallet)
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
      viewerIsSiteAdmin,
      milestoneBonusWins,
    ] = await Promise.all([
      Promise.resolve(rafflesForResponse),
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
      isWalletRegisteredAdmin(wallet).catch((err) => {
        console.error('[me/dashboard] admin check:', err instanceof Error ? err.message : err)
        return false
      }),
      listMilestoneBonusWinsForWallet(wallet).catch((err) => {
        console.error('[me/dashboard] milestone bonus wins:', err instanceof Error ? err.message : err)
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

    const buyoutOffersWithDepositSource = await enrichBuyoutOffersRefundDepositSource(buyoutOffers)

    const referralProgramActive = await isReferralProgramEnabled()

    let referralGrowth: {
      monthlyCap: number
      monthlyUsed: number
      monthlyRemaining: number
      isHolder: boolean
      monthKey: string
      resetsAt: string
      pendingRewards: Awaited<ReturnType<typeof listPendingReferralRewardsForWallet>>
      eligibleRaffles: Array<{ id: string; slug: string; title: string }>
    } | null = null

    if (referralProgramActive && (await isReferralGrowthProgramActive())) {
      try {
        const [monthly, pendingRewards] = await Promise.all([
          getReferrerMonthlyUsage(wallet),
          listPendingReferralRewardsForWallet(wallet),
        ])
        const { data: liveRaffles } = await getSupabaseAdmin()
          .from('raffles')
          .select('id, slug, title, currency, is_active, end_time, purchases_blocked_at')
          .eq('is_active', true)
          .in('currency', ['SOL', 'USDC'])
          .limit(80)
        const eligibleRaffles = (liveRaffles ?? [])
          .filter((r) => raffleEligibleForReferralFreeEntry(r))
          .map((r) => ({ id: r.id, slug: r.slug, title: r.title }))
        referralGrowth = {
          monthlyCap: monthly.cap,
          monthlyUsed: monthly.used,
          monthlyRemaining: monthly.remaining,
          isHolder: monthly.isHolder,
          monthKey: monthly.monthKey,
          resetsAt: monthly.resetsAt,
          pendingRewards,
          eligibleRaffles,
        }
      } catch (e) {
        console.error('[me/dashboard] referral growth:', e instanceof Error ? e.message : e)
      }
    }

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
        referralProgramActive && referralSummary != null
          ? { ...referralSummary, canSetVanity: canSetVanityReferral }
          : null,
      referralGrowth: referralProgramActive ? referralGrowth : null,
      buyoutOffers: buyoutOffersWithDepositSource,
      engagement,
      /** True when session wallet is listed in `admins` (unlock partner hub preview, etc.). */
      viewerIsSiteAdmin,
      milestoneBonusWins,
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
