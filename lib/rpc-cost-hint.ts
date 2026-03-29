/**
 * Helius bills standard RPC methods (e.g. getParsedTokenAccountsByOwner) on the same URL as DAS.
 * Wallet adapter + client fallbacks use the resolved public RPC — if that is Helius, credits burn fast.
 */

import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'

let warnedWalletRpcHelius = false

export function warnIfWalletRpcIsHeliusDevOnce(): void {
  if (process.env.NODE_ENV !== 'development') return
  if (warnedWalletRpcHelius) return
  const url = resolvePublicSolanaRpcUrl()
  if (!url || !/helius-rpc\.com/i.test(url)) return
  warnedWalletRpcHelius = true
  console.info(
    '[OwlRaffle] Public Solana RPC (NEXT_PUBLIC_* / dev override) points at Helius. Browser wallet code calls getParsedTokenAccountsByOwner often; ' +
      'that uses RPC credits. For local dev, set NEXT_PUBLIC_DEV_SOLANA_RPC_URL to a free endpoint (e.g. https://solana.drpc.org or https://api.mainnet-beta.solana.com) and keep HELIUS_API_KEY for server DAS only. ' +
      'See .env.example (Dev RPC / Helius).'
  )
}
