import type { PublicKey } from '@solana/web3.js'

/**
 * Nesting on-chain view models — program ID and account layouts TBD.
 * Stubs only: wire real account structs when the staking program IDL is added.
 */
export type NestingProgramId = string

export type NestingOnChainAccountStub = {
  programId: PublicKey
  /** PDA of pool state, once `pdas` is wired to the program. */
  poolState: PublicKey
  /** Stake or receipt mint from pool config. */
  stakeMint?: string
  rewardMint?: string
}
