import type { WalletNft } from '@/lib/solana/wallet-tokens'

export type WalletNftSort = 'name' | 'collection'
export type WalletNftViewMode = 'grid' | 'list'

const UNCATEGORIZED_KEY = '__uncategorized__'

export function walletNftCollectionKey(nft: WalletNft): string {
  const name = nft.collectionName?.trim()
  if (name) return name
  const mint = nft.collectionMint?.trim()
  if (mint) return mint
  return UNCATEGORIZED_KEY
}

export function walletNftCollectionLabel(key: string): string {
  return key === UNCATEGORIZED_KEY ? 'Other / no collection' : key
}

/** Human-readable collection label for picker rows (name, else short mint, else fallback). */
export function walletNftCollectionDisplayLabel(nft: WalletNft): string {
  const name = nft.collectionName?.trim()
  if (name) return name
  const mint = nft.collectionMint?.trim()
  if (mint) {
    return mint.length > 16 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint
  }
  return 'No collection'
}

export interface WalletNftCollectionOption {
  key: string
  label: string
  count: number
}

export function groupWalletNftsByCollection(nfts: WalletNft[]): WalletNftCollectionOption[] {
  const counts = new Map<string, number>()
  for (const nft of nfts) {
    const key = walletNftCollectionKey(nft)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: walletNftCollectionLabel(key),
      count,
    }))
    .sort((a, b) => {
      if (a.key === UNCATEGORIZED_KEY) return 1
      if (b.key === UNCATEGORIZED_KEY) return -1
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    })
}

function nftSearchHaystack(nft: WalletNft): string {
  return [
    nft.name,
    nft.collectionName,
    nft.collectionMint,
    nft.symbol,
    nft.mint,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function filterWalletNfts(params: {
  nfts: WalletNft[]
  searchQuery: string
  collectionKey: string | 'all'
}): WalletNft[] {
  const q = params.searchQuery.trim().toLowerCase()
  let list = params.nfts
  if (params.collectionKey !== 'all') {
    list = list.filter((nft) => walletNftCollectionKey(nft) === params.collectionKey)
  }
  if (!q) return list
  return list.filter((nft) => nftSearchHaystack(nft).includes(q))
}

export function sortWalletNfts(nfts: WalletNft[], sort: WalletNftSort): WalletNft[] {
  const sorted = [...nfts]
  sorted.sort((a, b) => {
    if (sort === 'collection') {
      const col = walletNftCollectionLabel(walletNftCollectionKey(a)).localeCompare(
        walletNftCollectionLabel(walletNftCollectionKey(b)),
        undefined,
        { sensitivity: 'base' }
      )
      if (col !== 0) return col
    }
    const nameA = (a.name ?? a.mint).toLowerCase()
    const nameB = (b.name ?? b.mint).toLowerCase()
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' })
  })
  return sorted
}

export function paginateWalletNfts<T>(items: T[], page: number, pageSize: number): T[] {
  const safePage = Math.max(0, page)
  const start = safePage * pageSize
  return items.slice(start, start + pageSize)
}

export function walletNftMintMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
