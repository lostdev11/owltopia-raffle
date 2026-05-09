import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

/**
 * Helius JSON-RPC URL for server-side DAS calls (mainnet vs devnet from env).
 */
export function getHeliusRpcUrl(): string | null {
  const heliusKey = process.env.HELIUS_API_KEY?.trim()
  if (!heliusKey) return null
  const solanaUrl = resolveServerSolanaRpcUrl()
  const isDevnet = /devnet/i.test(solanaUrl)
  const base = isDevnet ? 'https://devnet.helius-rpc.com' : 'https://mainnet.helius-rpc.com'
  return `${base}/?api-key=${encodeURIComponent(heliusKey)}`
}

/**
 * Mainnet Helius URL for DAS — use for **mainnet-only** NFT collections even when `SOLANA_RPC_URL`
 * is devnet (same pattern as Owltopia holder checks in `platform-fees.ts`).
 */
export function getHeliusMainnetRpcUrl(): string | null {
  const heliusKey = process.env.HELIUS_API_KEY?.trim()
  if (!heliusKey) return null
  return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}`
}
