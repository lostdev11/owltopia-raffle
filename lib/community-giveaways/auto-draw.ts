import { notifyCommunityGiveawayWinnerDrawn } from '@/lib/discord-raffle-webhooks'
import {
  countEntriesByGiveawayId,
  drawCommunityGiveawayWinner,
  getCommunityGiveawayById,
  listOpenCommunityGiveawaysPastEnd,
} from '@/lib/db/community-giveaways'
import { getDiscordUserIdsByWallets } from '@/lib/db/wallet-profiles'
import type { CommunityGiveaway } from '@/lib/types'

export async function notifyDiscordCommunityGiveawayWinner(
  giveaway: CommunityGiveaway,
  winnerWallet: string
): Promise<void> {
  const discordMap = await getDiscordUserIdsByWallets([winnerWallet])
  await notifyCommunityGiveawayWinnerDrawn(giveaway, winnerWallet, discordMap[winnerWallet] ?? null)
}

export type CommunityGiveawayAutoDrawResult = {
  giveawayId: string
  title: string
  drawn: boolean
  winnerWallet: string | null
  skippedReason?: string
}

/** True when this giveaway may still need an automatic draw (past ends_at, still open). */
export function shouldAttemptCommunityGiveawayAutoDraw(g: CommunityGiveaway): boolean {
  if (g.status !== 'open' || g.winner_wallet) return false
  if (!g.prize_deposited_at || !g.ends_at) return false
  const endsMs = new Date(g.ends_at).getTime()
  if (Number.isNaN(endsMs) || Date.now() <= endsMs) return false
  return true
}

/**
 * Auto-draw when entry period is over (same gate as joining: prize deposited, ends_at set and passed).
 * Admin manual draw can still run before the deadline; this path only runs for past-deadline giveaways.
 */
export async function tryAutoDrawCommunityGiveaway(giveawayId: string): Promise<CommunityGiveawayAutoDrawResult> {
  const g = await getCommunityGiveawayById(giveawayId)
  if (!g) {
    return { giveawayId, title: '', drawn: false, winnerWallet: null, skippedReason: 'not_found' }
  }
  const title = g.title
  if (g.status !== 'open' || g.winner_wallet) {
    return { giveawayId, title, drawn: false, winnerWallet: null, skippedReason: 'not_open_or_already_drawn' }
  }
  if (!g.prize_deposited_at) {
    return { giveawayId, title, drawn: false, winnerWallet: null, skippedReason: 'prize_not_deposited' }
  }
  if (!g.ends_at) {
    return { giveawayId, title, drawn: false, winnerWallet: null, skippedReason: 'no_ends_at' }
  }
  const endsMs = new Date(g.ends_at).getTime()
  if (Number.isNaN(endsMs) || Date.now() <= endsMs) {
    return { giveawayId, title, drawn: false, winnerWallet: null, skippedReason: 'not_past_end' }
  }

  const n = await countEntriesByGiveawayId(giveawayId)
  if (n === 0) {
    return { giveawayId, title, drawn: false, winnerWallet: null, skippedReason: 'no_entries' }
  }

  const winner = await drawCommunityGiveawayWinner(giveawayId)
  if (!winner) {
    return { giveawayId, title, drawn: false, winnerWallet: null, skippedReason: 'draw_race_or_state' }
  }

  const updated = await getCommunityGiveawayById(giveawayId)
  if (updated) {
    try {
      await notifyDiscordCommunityGiveawayWinner(updated, winner)
    } catch (e) {
      console.error('[community-giveaway auto-draw] Discord notify failed:', e)
    }
  }

  return { giveawayId, title, drawn: true, winnerWallet: winner }
}

/** Cron: process all community giveaways that are past end and still open. */
export async function processEndedCommunityGiveawaysForAutoDraw(): Promise<CommunityGiveawayAutoDrawResult[]> {
  const nowIso = new Date().toISOString()
  const candidates = await listOpenCommunityGiveawaysPastEnd(nowIso)
  const results: CommunityGiveawayAutoDrawResult[] = []
  for (const g of candidates) {
    results.push(await tryAutoDrawCommunityGiveaway(g.id))
  }
  return results
}
