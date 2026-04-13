import { PublicKey } from '@solana/web3.js'

/** Default program id (matches `governance-anchor` workspace). */
export const DEFAULT_GOVERNANCE_PROGRAM_ID = 'FwEAjseYTP6vTp9g6SpBTgySWzm4yxCtBc3Ti7Rvcfyz'

export function getGovernanceProgramId(): PublicKey {
  const raw = process.env.NEXT_PUBLIC_GOVERNANCE_PROGRAM_ID?.trim()
  if (raw) return new PublicKey(raw)
  return new PublicKey(DEFAULT_GOVERNANCE_PROGRAM_ID)
}

/**
 * When set to your wallet (base58), Owl Council shows a one-time **Initialize governance** button
 * (only while the connected wallet matches). Use for devnet / first deploy.
 */
export function getGovernanceInitAuthority(): PublicKey | null {
  const raw = process.env.NEXT_PUBLIC_GOVERNANCE_INIT_AUTHORITY?.trim()
  if (!raw) return null
  try {
    return new PublicKey(raw)
  } catch {
    return null
  }
}

/**
 * When exactly `"true"`, any connected wallet can run Initialize (dev only — do not use in production).
 */
export function isGovernanceOpenInitEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOVERNANCE_ALLOW_OPEN_INIT?.trim() === 'true'
}

/** On-chain minimum voting duration (seconds). */
export const MIN_VOTING_SECS = 48 * 3600
/** On-chain maximum voting duration (seconds). */
export const MAX_VOTING_SECS = 7 * 24 * 3600
