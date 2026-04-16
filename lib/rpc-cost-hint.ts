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
    '[OwlRaffle] Wallet RPC points at Helius. Browser code calls getParsedTokenAccountsByOwner often; that uses RPC credits. ' +
      'Set NEXT_PUBLIC_WALLET_READ_RPC_URL (prod) or NEXT_PUBLIC_DEV_SOLANA_RPC_URL (dev) to a free HTTP endpoint, or keep HELIUS_API_KEY for server DAS only. ' +
      'See .env.example (Wallet read RPC / Helius).'
  )
}
