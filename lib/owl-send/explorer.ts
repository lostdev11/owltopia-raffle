import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'

/** Solscan tx URL for the site’s current cluster (devnet gets `?cluster=devnet`). */
export function OwlSendSolscanTxUrl(signature: string): string {
  const sig = signature.trim()
  if (!sig) return 'https://solscan.io'
  const q = /devnet/i.test(resolvePublicSolanaRpcUrl()) ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${encodeURIComponent(sig)}${q}`
}
