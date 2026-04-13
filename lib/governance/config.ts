import { PublicKey } from '@solana/web3.js'

/** Default program id (matches `governance-anchor` workspace). */
export const DEFAULT_GOVERNANCE_PROGRAM_ID = 'FwEAjseYTP6vTp9g6SpBTgySWzm4yxCtBc3Ti7Rvcfyz'

export function getGovernanceProgramId(): PublicKey {
  const raw = process.env.NEXT_PUBLIC_GOVERNANCE_PROGRAM_ID?.trim()
  if (raw) return new PublicKey(raw)
  return new PublicKey(DEFAULT_GOVERNANCE_PROGRAM_ID)
}

/** On-chain minimum voting duration (seconds). */
export const MIN_VOTING_SECS = 48 * 3600
/** On-chain maximum voting duration (seconds). */
export const MAX_VOTING_SECS = 7 * 24 * 3600
