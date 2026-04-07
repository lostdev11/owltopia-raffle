import { COMMUNITY_GIVEAWAY_MAX_DRAW_WEIGHT } from '@/lib/config/community-giveaways'
import { ownsOwltopia } from '@/lib/platform-fees'
import type { CommunityGiveaway, CommunityGiveawayEntry } from '@/lib/types'

export type JoinEligibility =
  | { ok: true }
  | { ok: false; reason: string; status?: number }

export async function canJoinCommunityGiveaway(
  g: CommunityGiveaway,
  walletAddress: string
): Promise<JoinEligibility> {
  if (g.status !== 'open') {
    return { ok: false, reason: 'This giveaway is not open for entries', status: 400 }
  }
  if (!g.prize_deposited_at) {
    return { ok: false, reason: 'Prize is not verified in escrow yet', status: 400 }
  }
  if (g.winner_wallet) {
    return { ok: false, reason: 'A winner has already been drawn', status: 400 }
  }
  const endsAt = g.ends_at ? new Date(g.ends_at).getTime() : null
  if (endsAt != null && !Number.isNaN(endsAt) && Date.now() > endsAt) {
    return { ok: false, reason: 'Entry period has ended', status: 400 }
  }

  if (g.access_gate === 'holder_only') {
    const isHolder = await ownsOwltopia(walletAddress.trim(), { skipCache: true, deepWalletScan: true })
    if (!isHolder) {
      return {
        ok: false,
        reason: 'This giveaway is for Owltopia (Owl NFT) holders only',
        status: 403,
      }
    }
  }

  return { ok: true }
}

export function canApplyOwlBoost(g: CommunityGiveaway, walletAddress: string): JoinEligibility {
  if (g.status !== 'open') {
    return { ok: false, reason: 'Giveaway is not open', status: 400 }
  }
  if (!g.prize_deposited_at) {
    return { ok: false, reason: 'Prize not verified yet', status: 400 }
  }
  const startMs = new Date(g.starts_at).getTime()
  if (Number.isNaN(startMs)) {
    return { ok: false, reason: 'Invalid giveaway schedule', status: 500 }
  }
  if (Date.now() >= startMs) {
    return {
      ok: false,
      reason: 'OWL boost window closed (starts_at has passed)',
      status: 400,
    }
  }
  if (!walletAddress.trim()) {
    return { ok: false, reason: 'Wallet required', status: 400 }
  }
  return { ok: true }
}

/** OWL boost window is open and entry is below max draw weight (1 OWL per +1 weight). */
export function canApplyMoreOwlBoost(
  g: CommunityGiveaway,
  walletAddress: string,
  entry: CommunityGiveawayEntry | null
): JoinEligibility {
  const window = canApplyOwlBoost(g, walletAddress)
  if (!window.ok) return window
  if (!entry) {
    return { ok: false, reason: 'Join the giveaway before applying an OWL boost', status: 400 }
  }
  const w = Math.max(1, Math.floor(Number(entry.draw_weight) || 1))
  if (w >= COMMUNITY_GIVEAWAY_MAX_DRAW_WEIGHT) {
    return { ok: false, reason: 'Maximum draw weight reached', status: 400 }
  }
  return { ok: true }
}
