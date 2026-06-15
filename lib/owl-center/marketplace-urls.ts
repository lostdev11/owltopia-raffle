import type { OwlMintNetwork } from '@/lib/solana/network'

/** Magic Eden Creator Hub — US users are redirected to .us from .io. */
export function magicEdenCreatorHubUrl(): string {
  return 'https://creators.magiceden.us/'
}

/** Suggested Magic Eden collection URL (Solana). */
export function suggestMagicEdenCollectionUrl(collectionMint: string, network: OwlMintNetwork = 'mainnet'): string {
  const mint = collectionMint.trim()
  if (!mint) return ''
  if (network === 'devnet') {
    return `https://magiceden.io/marketplace/devnet/${encodeURIComponent(mint)}`
  }
  return `https://magiceden.io/marketplace/${encodeURIComponent(mint)}`
}

/** Suggested Tensor collection trade URL. */
export function suggestTensorCollectionUrl(collectionMint: string): string {
  const mint = collectionMint.trim()
  if (!mint) return ''
  return `https://tensor.trade/trade/${encodeURIComponent(mint)}`
}

/** Hash list as newline-delimited mint addresses (ME / Tensor common format). */
export function formatHashListText(mints: string[]): string {
  return mints.filter((m) => m.trim().length > 0).join('\n')
}

export function formatHashListJson(mints: string[]): string {
  return JSON.stringify(mints.filter((m) => m.trim().length > 0), null, 2)
}
