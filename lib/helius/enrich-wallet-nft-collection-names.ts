import type { WalletNft } from '@/lib/solana/wallet-tokens'
import { fetchNftMintMetaBatchFromHelius } from '@/lib/nft-helius-image'

/**
 * Helius DAS often returns a collection mint on each NFT but omits the human-readable
 * collection name. Resolve names by batch-fetching the collection NFT assets.
 */
export async function enrichWalletNftCollectionNames(nfts: WalletNft[]): Promise<WalletNft[]> {
  const collectionMints = new Set<string>()
  for (const nft of nfts) {
    if (nft.collectionName?.trim()) continue
    const mint = nft.collectionMint?.trim()
    if (mint) collectionMints.add(mint)
  }
  if (collectionMints.size === 0) return nfts

  const metaByMint = await fetchNftMintMetaBatchFromHelius([...collectionMints])
  const nameByCollectionMint = new Map<string, string>()
  for (const [mint, meta] of metaByMint) {
    const name = meta.name?.trim()
    if (name) nameByCollectionMint.set(mint, name)
  }
  if (nameByCollectionMint.size === 0) return nfts

  return nfts.map((nft) => {
    if (nft.collectionName?.trim()) return nft
    const collectionMint = nft.collectionMint?.trim()
    if (!collectionMint) return nft
    const name = nameByCollectionMint.get(collectionMint)
    if (!name) return nft
    return { ...nft, collectionName: name }
  })
}
