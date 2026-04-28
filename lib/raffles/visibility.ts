import { PublicKey } from '@solana/web3.js'
import type { Raffle } from '@/lib/types'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'

function getCreatorWallet(raffle: Raffle): string | null {
  // Creator is duplicated in a couple columns in different parts of the codebase.
  return raffle.created_by ?? raffle.creator_wallet ?? null
}

/** Canonical base58 for comparisons (session vs DB vs wallet adapter). */
function normalizeSolanaAddress(addr: string | null | undefined): string | null {
  if (!addr?.trim()) return null
  const s = addr.trim()
  try {
    return new PublicKey(s).toBase58()
  } catch {
    return s
  }
}

function addressesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeSolanaAddress(a)
  const nb = normalizeSolanaAddress(b)
  if (na == null || nb == null) return false
  return na === nb
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
 * Raffles that are "pending" for public listing/admin pending buckets: blocked purchases, or
 * missing escrow verification while already live / draft-past-start. Uses `nowMs` so list
 * bucketing matches server time.
 */
export function isPendingNftRaffleAtTime(raffle: Raffle, nowMs: number): boolean {
  const hasBlockedPurchases = Boolean(raffle.purchases_blocked_at)
  // Admin pause always counts as pending (independent of escrow policy or prize type).
  if (hasBlockedPurchases) return true

  const startTimeMs = new Date(raffle.start_time).getTime()
  const status = (raffle.status ?? '').toLowerCase()
  const missingDeposit = !raffle.prize_deposited_at
  const draftHasStarted = status === 'draft' && !isNaN(startTimeMs) && startTimeMs <= nowMs
  const liveHasStarted = status === 'live'

  if (isPartnerSplPrizeRaffle(raffle)) {
    if (nftRaffleExemptFromEscrowRequirement(raffle)) return false
    return missingDeposit && (draftHasStarted || liveHasStarted)
  }

  // Keep legacy NFT pre-escrow exemption behavior intact.
  if (raffle.prize_type === 'nft' && nftRaffleExemptFromEscrowRequirement(raffle)) return false

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
  // Do not hide legacy/public non-escrow crypto raffles (e.g. SOL) behind pending visibility.
  // Pending visibility gating is only for escrow-gated raffle types.
  if (raffle.prize_type !== 'nft' && !isPartnerSplPrizeRaffle(raffle)) return true

  // Only restrict "pending NFT" raffles; everything else is public.
  if (!isPendingNftRaffle(raffle)) return true

  if (viewerIsAdmin) return true

  const creatorWallet = getCreatorWallet(raffle)
  if (!viewerWallet || !creatorWallet) return false

  return addressesEqual(viewerWallet, creatorWallet)
}

/**
 * Filters out pending NFT raffles for non-admin viewers.
 * Non-pending raffles are preserved.
 */
export function filterRafflesByPendingVisibility(raffles: Raffle[], viewerWallet: string | null, viewerIsAdmin: boolean): Raffle[] {
  return raffles.filter((r) => canViewerSeeRafflePending(r, viewerWallet, viewerIsAdmin))
}

