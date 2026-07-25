import type { WalletAdapter } from '@solana/wallet-adapter-base'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCore } from '@metaplex-foundation/mpl-core'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'

import { mplCoreCandyMachine } from '@/lib/solana/core-candy-machine'
import { getSolanaRpcUrl } from '@/lib/solana/network'

/**
 * Browser Umi for Core Candy Machine + MPL Core mints (partner public_simple).
 */
export function createOwlCenterCoreUmi(walletAdapter: WalletAdapter, rpcUrl?: string) {
  const rpc = rpcUrl?.trim() || getSolanaRpcUrl()
  return createUmi(rpc, { commitment: 'confirmed' })
    .use(mplCore())
    .use(mplCoreCandyMachine())
    .use(walletAdapterIdentity(walletAdapter))
}
