/**
 * Helius JSON-RPC URL for server-side DAS calls (mainnet vs devnet from env).
 */
export function getHeliusRpcUrl(): string | null {
  const heliusKey = process.env.HELIUS_API_KEY?.trim()
  if (!heliusKey) return null
  const solanaUrl = (process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || '').trim()
  const isDevnet = /devnet/i.test(solanaUrl)
  const base = isDevnet ? 'https://devnet.helius-rpc.com' : 'https://mainnet.helius-rpc.com'
  return `${base}/?api-key=${encodeURIComponent(heliusKey)}`
}
