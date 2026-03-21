import type { Raffle } from '@/lib/types'

function getCreatorWallet(raffle: Raffle): string | null {
  // Creator is duplicated in a couple columns in different parts of the codebase.
  return raffle.created_by ?? raffle.creator_wallet ?? null
}

let cachedEscrowRequiredSinceMs: number | null | undefined

/**
 * When set (ISO 8601), NFT raffles with `created_at` **before** this instant are treated as
 * pre-escrow: they are not hidden from the public list and ticket creation is not blocked
 * solely for missing `prize_deposited_at`. Must be `NEXT_PUBLIC_*` so server and browser
 * apply the same rules (RSC + `/api/raffles` + client Supabase fallback).
 */
function getEscrowRequiredSinceMs(): number | null {
  if (cachedEscrowRequiredSinceMs !== undefined) return cachedEscrowRequiredSinceMs
  const raw = process.env.NEXT_PUBLIC_ESCROW_REQUIRED_SINCE?.trim()
  if (!raw) {
    cachedEscrowRequiredSinceMs = null
    return null
  }
  const t = Date.parse(raw)
  cachedEscrowRequiredSinceMs = Number.isFinite(t) ? t : null
  return cachedEscrowRequiredSinceMs
}

/** True for legacy NFT raffles created before on-chain escrow was required. */
export function nftRaffleExemptFromEscrowRequirement(raffle: Raffle): boolean {
  const since = getEscrowRequiredSinceMs()
  if (since == null) return false
  const created = Date.parse(raffle.created_at)
  if (!Number.isFinite(created)) return false
  return created < since
}

/**
 * NFT raffles that are "pending" for public listing: blocked purchases, or missing escrow
 * verification while already live / draft-past-start. Uses `nowMs` so list bucketing matches server time.
 */
export function isPendingNftRaffleAtTime(raffle: Raffle, nowMs: number): boolean {
  if (raffle.prize_type !== 'nft') return false

  const hasBlockedPurchases = Boolean(raffle.purchases_blocked_at)
  // Admin pause always counts as pending (independent of legacy escrow cutoff).
  if (hasBlockedPurchases) return true

  if (nftRaffleExemptFromEscrowRequirement(raffle)) return false

  const startTimeMs = new Date(raffle.start_time).getTime()
  const status = (raffle.status ?? '').toLowerCase()
  const missingDeposit = !raffle.prize_deposited_at

  const draftHasStarted = status === 'draft' && !isNaN(startTimeMs) && startTimeMs <= nowMs
  const liveHasStarted = status === 'live'

  return missingDeposit && (draftHasStarted || liveHasStarted)
}

function isPendingNftRaffle(raffle: Raffle): boolean {
  return isPendingNftRaffleAtTime(raffle, Date.now())
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

