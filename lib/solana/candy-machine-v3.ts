/**
 * Re-export boundary for Metaplex Candy Machine V3 (Token Metadata NFTs).
 *
 * Peer deps (Metaplex):
 * - @metaplex-foundation/umi
 * - @metaplex-foundation/umi-bundle-defaults
 * - @metaplex-foundation/mpl-candy-machine
 * - @metaplex-foundation/mpl-token-metadata
 * - @metaplex-foundation/umi-signer-wallet-adapters
 *
 * TODO(mainnet): Final CM ID + candy guard groups per phase (presale vs SOL payment).
 * TODO: MPL Core Candy Machine is out of scope for Gen2 V1 — keep imports here TM-only.
 */
export { mplCandyMachine, mintV2 } from '@metaplex-foundation/mpl-candy-machine'
export type { MintV2InstructionAccounts } from '@metaplex-foundation/mpl-candy-machine'
