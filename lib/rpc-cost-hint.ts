/**
 * Helius bills standard RPC methods (e.g. getParsedTokenAccountsByOwner) on the same URL as DAS.
 * Wallet adapter + client fallbacks use the resolved public RPC — if that is Helius, credits burn fast.
 */

import { resolveWalletAdapterRpcUrl } from '@/lib/solana-rpc-url'

let warnedWalletRpcHelius = false

export function warnIfWalletRpcIsHeliusDevOnce(): void {
  if (process.env.NODE_ENV !== 'development') return
  if (warnedWalletRpcHelius) return
  const url = resolveWalletAdapterRpcUrl()
  if (!url || !/helius-rpc\.com/i.test(url)) return
  warnedWalletRpcHelius = true
  console.info(
    '[OwlRaffle] Wallet RPC points at Helius. Wallet reads (e.g. getParsedTokenAccountsByOwner) use RPC credits; NFT list fallback batches Metaplex metadata via getMultipleAccounts instead of many getAccountInfo calls. ' +
      'Set NEXT_PUBLIC_WALLET_READ_RPC_URL (prod) or NEXT_PUBLIC_DEV_SOLANA_RPC_URL (dev) to a free HTTP endpoint; keep HELIUS_API_KEY for server DAS. ' +
      'See .env.example (Wallet read RPC / Helius).'
  )
}
