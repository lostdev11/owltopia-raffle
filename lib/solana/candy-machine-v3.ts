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
 * Mainnet CM id comes from `NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID` / `owl_center_launches`;
 * candy guard groups per phase (`gen1` / `pre` / `wl` / `pub`) are resolved at mint time by
 * `lib/solana/gen2-guards.ts` (allowList merkle, solPayment destination, mintLimit).
 *
 * TODO: MPL Core Candy Machine is out of scope for Gen2 V1 — keep imports here TM-only.
 */
export { mplCandyMachine, mintV2 } from '@metaplex-foundation/mpl-candy-machine'
export type { MintV2InstructionAccounts } from '@metaplex-foundation/mpl-candy-machine'
