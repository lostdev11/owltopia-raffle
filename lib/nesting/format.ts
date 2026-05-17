/** Client-safe display helpers for Owl Nesting UI. */

/** Tokens vs NFTs for perch cards and the nest flow (friendly copy—backend still calls them pools). */
export function perchAssetKindLabel(assetType: string): string {
  if (assetType === 'token') return 'Tokens'
  if (assetType === 'nft') return 'NFTs'
  return assetType
}

export function formatRewardRate(rate: number, unit: string): string {
  const r = Number(rate)
  if (!Number.isFinite(r)) return '—'
  const label =
    unit === 'hourly' ? '/ hr' : unit === 'weekly' ? '/ wk' : '/ day'
  return `${r}${label}`
}

export function shortenAddress(addr: string, chars = 4): string {
  const a = addr.trim()
  if (a.length <= chars * 2 + 1) return a
  return `${a.slice(0, chars)}…${a.slice(-chars)}`
}
