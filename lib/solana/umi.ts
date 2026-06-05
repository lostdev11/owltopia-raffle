import type { WalletAdapter } from '@solana/wallet-adapter-base'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCandyMachine } from '@metaplex-foundation/mpl-candy-machine'
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'

import { getSolanaRpcUrl } from '@/lib/solana/network'

/**
 * Browser-only Umi instance for Candy Machine V3 + Token Metadata mints.
 *
 * Required packages (already in package.json):
 * - @metaplex-foundation/umi
 * - @metaplex-foundation/umi-bundle-defaults
 * - @metaplex-foundation/mpl-candy-machine
 * - @metaplex-foundation/mpl-token-metadata
 * - @metaplex-foundation/umi-signer-wallet-adapters
 *
 * TODO(mainnet): Confirm RPC / commitment settings for production CM + guard groups.
 */
export function createOwlCenterUmi(walletAdapter: WalletAdapter, rpcUrl?: string) {
  const rpc = rpcUrl?.trim() || getSolanaRpcUrl()
  return createUmi(rpc).use(mplCandyMachine()).use(mplTokenMetadata()).use(walletAdapterIdentity(walletAdapter))
}
