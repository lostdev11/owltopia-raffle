/** Persist acknowledgment so returning users are not blocked on every visit (session-only, not durable consent). */
export const NESTING_SECURITY_ACK_STORAGE_KEY = 'owl_nesting_security_ack_v1'

/** Copy reviewed against `/api/me/staking/*`, `lib/auth-server`, and `lib/nesting/service.ts`. */
export const NESTING_SECURITY_BULLETS: readonly string[] = [
  'Sign-in with Solana (SIWS): the server issues a time-bound nonce; only a valid wallet signature creates your session cookie.',
  'Every staking API call checks your session wallet; if you send X-Connected-Wallet it must match the session or the request is rejected (401).',
  'Stake, unstake, and claim run only on the server after validation — clients never write staking rows directly to the database.',
  'Pool and position IDs are validated server-side (UUIDs, ownership, pool active rules). Mock pools store state in Supabase only unless the pool is configured for on-chain sync.',
]
