/** Solscan transaction URL for current cluster (`NEXT_PUBLIC_SOLANA_CLUSTER`, default mainnet-beta). */
export function gen2PresaleExplorerTxUrl(signature: string): string {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() || 'mainnet-beta'
  const base = `https://solscan.io/tx/${encodeURIComponent(signature)}`
  if (cluster === 'mainnet-beta') return base
  return `${base}?cluster=${encodeURIComponent(cluster)}`
}
