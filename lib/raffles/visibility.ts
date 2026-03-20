import type { Raffle } from '@/lib/types'

function getCreatorWallet(raffle: Raffle): string | null {
  // Creator is duplicated in a couple columns in different parts of the codebase.
  return raffle.created_by ?? raffle.creator_wallet ?? null
}

function isPendingNftRaffle(raffle: Raffle): boolean {
  if (raffle.prize_type !== 'nft') return false

  const nowMs = Date.now()
  const startTimeMs = new Date(raffle.start_time).getTime()
  const status = (raffle.status ?? '').toLowerCase()

  // Pending/paused means the NFT prize is not in verified platform escrow yet (or purchases are blocked),
  // and the raffle is already "in progress" from the user's perspective.
  const hasBlockedPurchases = Boolean(raffle.purchases_blocked_at)
  const missingDeposit = !raffle.prize_deposited_at

  const draftHasStarted = status === 'draft' && !isNaN(startTimeMs) && startTimeMs <= nowMs
  const liveHasStarted = status === 'live' // "live" implies start_time <= now for our bucketing logic

  return hasBlockedPurchases || (missingDeposit && (draftHasStarted || liveHasStarted))
}

/**
 * Pending NFT raffles are hidden from the public (including OG image previews),
 * but are visible to admins and the raffle creator.
 */
export function canViewerSeeRafflePending(raffle: Raffle, viewerWallet: string | null, viewerIsAdmin: boolean): boolean {
  // Only restrict "pending NFT" raffles; everything else is public.
  if (!isPendingNftRaffle(raffle)) return true

  if (viewerIsAdmin) return true

  const creatorWallet = getCreatorWallet(raffle)
  if (!viewerWallet || !creatorWallet) return false

  return viewerWallet === creatorWallet
}

/**
 * Filters out pending NFT raffles for non-admin viewers.
 * Non-pending raffles are preserved.
 */
export function filterRafflesByPendingVisibility(raffles: Raffle[], viewerWallet: string | null, viewerIsAdmin: boolean): Raffle[] {
  return raffles.filter((r) => canViewerSeeRafflePending(r, viewerWallet, viewerIsAdmin))
}

