import {
  countAvailableNfts,
  getPackProductById,
  getPackVaultConfig,
  updatePackProduct,
} from '@/lib/packs/db'

async function pauseProductShelf(productId: string, reason: string): Promise<void> {
  await updatePackProduct(productId, {
    shelf_paused: true,
    shelf_pause_reason: reason,
  })
}

/** After an open completes, re-check shelf inventory without pausing other products. */
export async function ensureProductShelfAfterOpen(productId: string): Promise<void> {
  const product = await getPackProductById(productId)
  if (!product) return
  const config = await getPackVaultConfig()
  const minNft = Number(product.min_nft_count ?? config.min_nft_count ?? 1)
  const nftCount = await countAvailableNfts(productId)
  if (nftCount < minNft && !product.shelf_paused) {
    await pauseProductShelf(
      productId,
      `Low NFT inventory on this shelf (${nftCount} < min ${minNft})`
    )
  }
}

export async function pauseProductShelfForReason(
  productId: string,
  reason: string
): Promise<void> {
  await pauseProductShelf(productId, reason)
}
