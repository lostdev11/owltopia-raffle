/**
 * Deep links to Solana NFT listings on major marketplaces (by mint).
 * Item pages show collection context so users can verify floor vs. raffle listing.
 *
 * Orbis web UI (preferred): https://www.orbisonsol.io/marketplace/{collectionPathname}/{mint}
 * Mint-only fallback: https://www.orbisonsol.io/marketplace/item/{mint} (SSR when indexed)
 * API reference: https://www.orbisonsol.io/marketplace/developer
 */
export function magicEdenNftUrl(mint: string): string {
  const m = mint.trim()
  return `https://magiceden.io/item-details/${encodeURIComponent(m)}`
}

export function tensorNftUrl(mint: string): string {
  const m = mint.trim()
  return `https://www.tensor.trade/item/${encodeURIComponent(m)}`
}

export function orbisNftUrl(
  mint: string,
  options?: { collectionPathname?: string | null },
): string {
  const m = mint.trim()
  const pathname = options?.collectionPathname?.trim()
  if (pathname) {
    return `https://www.orbisonsol.io/marketplace/${encodeURIComponent(pathname)}/${encodeURIComponent(m)}`
  }
  return `https://www.orbisonsol.io/marketplace/item/${encodeURIComponent(m)}`
}

export function hasNftMarketplaceMint(mint: string | null | undefined): boolean {
  return typeof mint === 'string' && mint.trim().length > 0
}
