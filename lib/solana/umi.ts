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
 * - @metaplex-foundation/mpl-toolbox (compute budget ixs)
 * - @metaplex-foundation/umi-signer-wallet-adapters
 *
 * Production (mainnet) RPC: `NEXT_PUBLIC_SOLANA_RPC_URL` must be a paid endpoint that can
 * absorb mint-window bursts (Helius/Triton). Commitment is `confirmed` for both reads
 * (CM/guard fetch) and sends — finalized is too slow for the mint UI, processed is unsafe
 * for the confirm-mint server verification that follows each tx.
 */
export function createOwlCenterUmi(walletAdapter: WalletAdapter, rpcUrl?: string) {
  const rpc = rpcUrl?.trim() || getSolanaRpcUrl()
  return createUmi(rpc, { commitment: 'confirmed' })
    .use(mplCandyMachine())
    .use(mplTokenMetadata())
    .use(walletAdapterIdentity(walletAdapter))
}
