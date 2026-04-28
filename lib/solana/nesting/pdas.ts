import { PublicKey } from '@solana/web3.js'

/**
 * PDA seeds are placeholders until the real staking program publishes seed layout.
 *
 * TODO: replace with program-derived addresses from IDL (pool authority, user position, reward vault, …).
 */

export function deriveNestingPoolStatePdaStub(
  _programId: PublicKey,
  _poolIdUuid: string
): PublicKey {
  // Placeholder: not a real PDA derivation — return program id to force callers to branch on "not wired"
  // without throwing at import time. Real impl: `PublicKey.findProgramAddressSync([Buffer.from('pool'), ...], programId)
  return _programId
}

export function deriveNestingUserPositionPdaStub(
  _programId: PublicKey,
  _user: PublicKey,
  _poolState: PublicKey
): PublicKey {
  return _programId
}
