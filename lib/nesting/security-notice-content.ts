/** Persist acknowledgment so returning users are not blocked on every visit (session-only, not durable consent). */
export const NESTING_SECURITY_ACK_STORAGE_KEY = 'owl_nesting_security_ack_v1'

/** Accuracy checked against staking APIs / auth (`lib/auth-server`) / `lib/nesting/service.ts`; wording is plain-language only. */
export const NESTING_SECURITY_BULLETS: readonly string[] = [
  'You approve one short sign-in message so we know it is your wallet—we never touch seed phrases or private keys.',
  'Whatever wallet stays connected must match what you signed in with, so nests never hop to the wrong person.',
  'Nesting moves run through Owltopia’s servers after safety checks—we do not expose direct database taps from your browser.',
  'For freeze-backed Owl Nest NFT perches, the NFT stays in your wallet but cannot transfer while it is frozen.',
  'Every tap double-checks perch rules, IDs, amounts, and that the nest belongs to you before anything changes.',
  'OWL reward claims are delivered on-chain from the platform reward treasury when it is configured and funded; otherwise only your in-app totals update.',
]
