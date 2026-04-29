/**
 * When `REFERRAL_ATTRIBUTION_ENABLED=false`, we do not persist referrer on new entries and the referral leaderboard is empty.
 * Use for dry-runs; default is enabled when unset.
 */
export function isReferralAttributionEnabled(): boolean {
  return process.env.REFERRAL_ATTRIBUTION_ENABLED !== 'false'
}

/**
 * When `REFERRAL_COMPLIMENTARY_TICKET_ENABLED=true`, a buyer can get one free ticket (qty 1) per wallet
 * lifetime (any raffle) if they use a valid referral link, have no prior confirmed entry on that raffle,
 * and have never confirmed a referral complimentary row before.
 */
export function isReferralComplimentaryTicketEnabled(): boolean {
  return process.env.REFERRAL_COMPLIMENTARY_TICKET_ENABLED === 'true'
}
