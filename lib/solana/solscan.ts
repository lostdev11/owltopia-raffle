/** Solscan URLs respecting `NEXT_PUBLIC_SOLANA_CLUSTER` (default mainnet-beta). */

function solscanClusterQuery(): string {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() || 'mainnet-beta'
  if (cluster === 'mainnet-beta') return ''
  return `?cluster=${encodeURIComponent(cluster)}`
}

export function solscanTransactionUrl(signature: string): string {
  const sig = signature.trim()
  return `https://solscan.io/tx/${encodeURIComponent(sig)}${solscanClusterQuery()}`
}

export function solscanAccountUrl(address: string): string {
  const addr = address.trim()
  return `https://solscan.io/account/${encodeURIComponent(addr)}${solscanClusterQuery()}`
}
