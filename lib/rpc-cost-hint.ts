/**
 * Helius bills standard RPC methods (e.g. getParsedTokenAccountsByOwner) on the same URL as DAS.
 * Wallet adapter + client fallbacks use NEXT_PUBLIC_SOLANA_RPC_URL — if that is Helius, credits burn fast.
 */

let warnedWalletRpcHelius = false

export function warnIfWalletRpcIsHeliusDevOnce(): void {
  if (process.env.NODE_ENV !== 'development') return
  if (warnedWalletRpcHelius) return
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ?? ''
  if (!url || !/helius-rpc\.com/i.test(url)) return
  warnedWalletRpcHelius = true
  console.info(
    '[OwlRaffle] NEXT_PUBLIC_SOLANA_RPC_URL uses Helius. Browser wallet code calls getParsedTokenAccountsByOwner often; ' +
      'that uses RPC credits. To ease off paid tiers: point this at a public/free RPC and keep HELIUS_API_KEY for server DAS only. ' +
      'See .env.example (Helius / free tier).'
  )
}
