import { OWLTOPIA_COLLECTION_ADDRESS } from '@/lib/config/raffles'
import { dasAssetBelongsToCollection } from '@/lib/helius/das-asset-collection'

/**
 * Full Owltopia Gen1 holder scan (mainnet DAS `getAssetsByGroup`) for the Gen2 airdrop
 * allowlist snapshot. Returns owner → NFT count for every non-burnt Gen1 asset.
 *
 * Note: NFTs sitting in marketplace / escrow program accounts snapshot the escrow as the
 * owner — tell holders to delist before the snapshot block.
 */

export type Gen1HolderScanResult =
  | { ok: true; holders: Array<{ wallet: string; gen1_nft_count: number }>; assets_scanned: number }
  | { ok: false; error: string }

const PAGE_LIMIT = 1000
const MAX_PAGES = 10 // 10k assets — far above the 2k-scale Gen1 collection.

export async function scanGen1HoldersFromChain(): Promise<Gen1HolderScanResult> {
  const collectionAddress = OWLTOPIA_COLLECTION_ADDRESS?.trim()
  if (!collectionAddress || collectionAddress === 'REPLACE_WITH_COLLECTION') {
    return { ok: false, error: 'OWLTOPIA_COLLECTION_ADDRESS is not configured' }
  }
  const heliusApiKey = process.env.HELIUS_API_KEY?.trim()
  if (!heliusApiKey) {
    return { ok: false, error: 'HELIUS_API_KEY is required for the on-chain holder scan' }
  }

  const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusApiKey)}`
  const counts = new Map<string, number>()
  const seenAssets = new Set<string>()
  let assetsScanned = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `gen1-holder-scan-${page}`,
        method: 'getAssetsByGroup',
        params: {
          groupKey: 'collection',
          groupValue: collectionAddress,
          page,
          limit: PAGE_LIMIT,
          options: { showUnverifiedCollections: true },
        },
      }),
    })
    if (!res.ok) {
      return { ok: false, error: `DAS getAssetsByGroup failed (HTTP ${res.status})` }
    }

    const json: { error?: { message?: string }; result?: { items?: unknown[] } } = await res
      .json()
      .catch(() => ({}))
    if (json.error) {
      return { ok: false, error: `DAS getAssetsByGroup error: ${json.error.message ?? 'unknown'}` }
    }

    const items = json.result?.items
    if (!Array.isArray(items) || items.length === 0) break

    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const o = item as { id?: string; burnt?: boolean; ownership?: { owner?: string } }
      if (o.burnt === true) continue
      if (!dasAssetBelongsToCollection(item, collectionAddress)) continue
      if (o.id) {
        if (seenAssets.has(o.id)) continue
        seenAssets.add(o.id)
      }
      const owner = o.ownership?.owner?.trim()
      if (!owner) continue
      counts.set(owner, (counts.get(owner) ?? 0) + 1)
      assetsScanned++
    }

    if (items.length < PAGE_LIMIT) break
  }

  if (assetsScanned === 0) {
    return { ok: false, error: 'Scan found no Gen1 assets — check collection address and Helius key' }
  }

  const holders = [...counts.entries()]
    .map(([wallet, gen1_nft_count]) => ({ wallet, gen1_nft_count }))
    .sort((a, b) => (a.wallet < b.wallet ? -1 : 1))

  return { ok: true, holders, assets_scanned: assetsScanned }
}
