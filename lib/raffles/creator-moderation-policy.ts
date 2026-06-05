import type { Raffle } from '@/lib/types'

/** Listing deposit tiers (lamports) by current strike_count on blacklist before this raffle goes live. */
export const MODERATION_LISTING_FEE_LAMPORTS_BY_STRIKE = [
  50_000_000, // 0 strikes — first paid listing while blacklisted
  100_000_000, // 1 strike
  200_000_000, // 2 strikes — last allowed tier
] as const

export const MODERATION_MAX_STRIKES_BEFORE_BAN = 3

export function listingFeeLamportsForStrikeCount(strikeCount: number): number | null {
  if (!Number.isFinite(strikeCount) || strikeCount < 0) return null
  if (strikeCount >= MODERATION_MAX_STRIKES_BEFORE_BAN) return null
  return MODERATION_LISTING_FEE_LAMPORTS_BY_STRIKE[strikeCount] ?? null
}

export function listingFeeSolForStrikeCount(strikeCount: number): number | null {
  const lamports = listingFeeLamportsForStrikeCount(strikeCount)
  if (lamports == null) return null
  return lamports / 1_000_000_000
}

export function isCreatorModerationBanned(strikeCount: number, bannedAt: string | null | undefined): boolean {
  if (bannedAt) return true
  return strikeCount >= MODERATION_MAX_STRIKES_BEFORE_BAN
}

export function raffleHasCreatorModerationBuyerFlag(raffle: Pick<Raffle, 'creator_restricted_listing'>): boolean {
  return raffle.creator_restricted_listing === true
}

export function raffleRequiresModerationListingFee(
  raffle: Pick<
    Raffle,
    'creator_restricted_listing' | 'moderation_listing_fee_lamports' | 'moderation_listing_fee_paid_at'
  >
): boolean {
  if (!raffle.creator_restricted_listing) return false
  const lamports = raffle.moderation_listing_fee_lamports
  if (lamports == null || lamports <= 0) return false
  return !raffle.moderation_listing_fee_paid_at
}

export function raffleModerationListingFeePaid(
  raffle: Pick<Raffle, 'moderation_listing_fee_lamports' | 'moderation_listing_fee_paid_at'>
): boolean {
  const lamports = raffle.moderation_listing_fee_lamports
  if (lamports == null || lamports <= 0) return true
  return !!raffle.moderation_listing_fee_paid_at
}

export const CREATOR_MODERATION_BUYER_WARNING =
  'This host is on Owltopia’s moderation list. We recommend not buying tickets — purchase at your own risk.'

export const CREATOR_MODERATION_BUYER_BADGE = 'Moderation flag'
