import {
  extractDasAssetCollectionMint,
  extractDasAssetCollectionName,
} from '@/lib/helius/das-asset-collection'
import {
  fetchDasAssetBatchFromHelius,
  fetchNftMintMetaBatchFromHelius,
  pickImageFromHeliusAsset,
} from '@/lib/nft-helius-image'
import { sanitizeLaunchMintPubkey } from '@/lib/solana/validate-pubkey'

export type DasCollectionHint = {
  collectionMint: string | null
  collectionName: string | null
  imageUrl: string | null
}

/** Resolve on-chain collection mint/name/image from a prize asset via Helius DAS. */
export async function resolveDasCollectionHint(prizeMint: string): Promise<DasCollectionHint> {
  const id = prizeMint.trim()
  if (!id) return { collectionMint: null, collectionName: null, imageUrl: null }
  try {
    const payloads = await fetchDasAssetBatchFromHelius([id], { preferMainnet: true })
    const asset = payloads.get(id) ?? payloads.values().next().value
    if (!asset) return { collectionMint: null, collectionName: null, imageUrl: null }
    const rawMint = extractDasAssetCollectionMint(asset)
    const collectionMint = sanitizeLaunchMintPubkey(rawMint)
    let collectionName = extractDasAssetCollectionName(asset)
    let imageUrl = pickImageFromHeliusAsset(asset)
    // Prize DAS often has the collection mint but omits the collection display name.
    // Fetch the collection NFT itself (same pattern as enrichWalletNftCollectionNames).
    if (collectionMint && !collectionName) {
      const meta = await fetchNftMintMetaBatchFromHelius([collectionMint], { preferMainnet: true })
      const hit = meta.get(collectionMint)
      if (hit?.name?.trim()) collectionName = hit.name.trim()
      if (!imageUrl && hit?.image?.trim()) imageUrl = hit.image.trim()
    }
    return { collectionMint, collectionName, imageUrl }
  } catch (err) {
    console.warn('[platform-projects] DAS collection resolve failed:', err)
    return { collectionMint: null, collectionName: null, imageUrl: null }
  }
}
