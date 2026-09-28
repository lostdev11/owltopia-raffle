import type { WalletNft } from '@/lib/solana/wallet-tokens'
import { OWLTOPIA_GEN2_COLLECTION_MINT } from '@/lib/owltopia-marketplace-links'

/**
 * Collection NFTs (the mint other assets group under) have no parent collection on-chain,
 * so DAS leaves `collectionName` / `collectionMint` empty and the wallet picker shows
 * "No collection". When peers in the same wallet list reference this mint as
 * `collectionMint`, attach their collection name (or this asset's own name) so it
 * groups and labels with its members.
 *
 * Also labels the known Owltopia Gen2 collection mint when it appears alone.
 */
export function enrichCollectionNftSelfLabels(nfts: WalletNft[]): WalletNft[] {
  const peerNameByCollectionMint = new Map<string, string>()
  const referencedCollectionMints = new Set<string>()

  for (const nft of nfts) {
    const cm = nft.collectionMint?.trim()
    if (!cm) continue
    referencedCollectionMints.add(cm)
    const name = nft.collectionName?.trim()
    if (name && !peerNameByCollectionMint.has(cm)) {
      peerNameByCollectionMint.set(cm, name)
    }
  }

  let changed = false
  const out = nfts.map((nft) => {
    if (nft.collectionName?.trim()) return nft
    const mint = nft.mint?.trim()
    if (!mint) return nft

    if (referencedCollectionMints.has(mint)) {
      const label = peerNameByCollectionMint.get(mint) || nft.name?.trim() || null
      if (!label) return nft
      changed = true
      return { ...nft, collectionName: label }
    }

    if (mint === OWLTOPIA_GEN2_COLLECTION_MINT) {
      changed = true
      return { ...nft, collectionName: nft.name?.trim() || 'Owltopia G2' }
    }

    return nft
  })

  return changed ? out : nfts
}
