import {
  COMMUNITY_GIVEAWAY_MAX_DRAW_WEIGHT,
  COMMUNITY_GIVEAWAY_OWL_PER_EXTRA_ENTRY,
} from '@/lib/config/community-giveaways'
import { shouldAttemptCommunityGiveawayAutoDraw, tryAutoDrawCommunityGiveaway } from '@/lib/community-giveaways/auto-draw'
import { canApplyMoreOwlBoost } from '@/lib/community-giveaways/eligibility'
import { countEntriesByGiveawayId, getCommunityGiveawayById } from '@/lib/db/community-giveaways'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'
import type { CommunityGiveaway, CommunityGiveawayEntry } from '@/lib/types'

/** JSON shape returned by GET /api/public/community-giveaways/[id] and passed to the client from SSR. */
export type PublicCommunityGiveawayPageInfo = {
  id: string
  title: string
  nft_mint_address: string
  description: string | null
  access_gate: string
  status: string
  starts_at: string
  ends_at: string | null
  entryCount: number
  prizeDeposited: boolean
  winnerDrawn: boolean
  claimed: boolean
  owlBoostWindowOpen: boolean
  owlBoostUiAmount: number
  maxDrawWeight: number
  owlPayment: {
    treasuryWallet: string
    mint: string
    decimals: number
    uiAmount: number
  } | null
}

export type CommunityGiveawayMeStatusPayload = {
  joined: boolean
  drawWeight: number | null
  maxDrawWeight: number
  canOwlBoostMore: boolean
  isWinner: boolean
  readyToClaim: boolean
  claimed: boolean
}

export function buildCommunityGiveawayMeStatus(
  g: CommunityGiveaway,
  wallet: string,
  entry: CommunityGiveawayEntry | null
): CommunityGiveawayMeStatusPayload {
  const w = wallet.trim()
  const isWinner =
    Boolean(g.winner_wallet?.trim()) && g.winner_wallet!.trim() === w && g.status === 'drawn'
  const readyToClaim = isWinner && Boolean(g.prize_deposited_at) && !g.claimed_at
  const boostEligibility = canApplyMoreOwlBoost(g, w, entry)
  return {
    joined: Boolean(entry),
    drawWeight: entry?.draw_weight ?? null,
    maxDrawWeight: COMMUNITY_GIVEAWAY_MAX_DRAW_WEIGHT,
    canOwlBoostMore: boostEligibility.ok,
    isWinner,
    readyToClaim,
    claimed: Boolean(g.claimed_at && isWinner),
  }
}

function buildPublicInfo(g: CommunityGiveaway, entryCount: number): PublicCommunityGiveawayPageInfo {
  const startMs = new Date(g.starts_at).getTime()
  const owlBoostWindowOpen =
    isOwlEnabled() &&
    g.status === 'open' &&
    Boolean(g.prize_deposited_at) &&
    !Number.isNaN(startMs) &&
    Date.now() < startMs

  const treasuryWallet = getRaffleTreasuryWalletAddress() ?? ''
  const owlInfo = getTokenInfo('OWL')
  const owlPayment =
    owlBoostWindowOpen && treasuryWallet && owlInfo.mintAddress
      ? {
          treasuryWallet,
          mint: owlInfo.mintAddress,
          decimals: owlInfo.decimals,
          uiAmount: COMMUNITY_GIVEAWAY_OWL_PER_EXTRA_ENTRY,
        }
      : null

  return {
    id: g.id,
    title: g.title,
    nft_mint_address: g.nft_mint_address,
    description: g.description,
    access_gate: g.access_gate,
    status: g.status,
    starts_at: g.starts_at,
    ends_at: g.ends_at,
    entryCount,
    prizeDeposited: Boolean(g.prize_deposited_at),
    winnerDrawn: Boolean(g.winner_wallet),
    claimed: Boolean(g.claimed_at),
    owlBoostWindowOpen,
    owlBoostUiAmount: COMMUNITY_GIVEAWAY_OWL_PER_EXTRA_ENTRY,
    maxDrawWeight: COMMUNITY_GIVEAWAY_MAX_DRAW_WEIGHT,
    owlPayment,
  }
}

export type CommunityGiveawayPageBundle = {
  giveaway: CommunityGiveaway
  publicInfo: PublicCommunityGiveawayPageInfo
}

/**
 * Single server path for raffle-style SSR: load row, optional auto-draw, entry count, public payload.
 */
export async function loadCommunityGiveawayPageBundle(id: string): Promise<CommunityGiveawayPageBundle | null> {
  const trimmed = id.trim()
  if (!trimmed) return null

  let g = await getCommunityGiveawayById(trimmed)
  if (!g || g.status === 'draft') return null

  if (shouldAttemptCommunityGiveawayAutoDraw(g)) {
    await tryAutoDrawCommunityGiveaway(trimmed)
    const refreshed = await getCommunityGiveawayById(trimmed)
    if (refreshed && refreshed.status !== 'draft') {
      g = refreshed
    }
  }

  const entryCount = await countEntriesByGiveawayId(trimmed)
  return { giveaway: g, publicInfo: buildPublicInfo(g, entryCount) }
}
