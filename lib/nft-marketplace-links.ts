/**
 * Deep links to Solana NFT listings on major marketplaces (by mint).
 * Item pages show collection context so users can verify floor vs. raffle listing.
 */
export function magicEdenNftUrl(mint: string): string {
  const m = mint.trim()
  return `https://magiceden.io/item-details/${encodeURIComponent(m)}`
}

export function tensorNftUrl(mint: string): string {
  const m = mint.trim()
  return `https://www.tensor.trade/item/${encodeURIComponent(m)}`
}

export function hasNftMarketplaceMint(mint: string | null | undefined): boolean {
  return typeof mint === 'string' && mint.trim().length > 0
}
