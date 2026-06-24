import { dasAssetBelongsToCollection } from '@/lib/helius/das-asset-collection'

const PAGE_LIMIT = 1000
const MAX_PAGES = 50

/**
 * Snapshot the current distinct holder wallets of a Metaplex Core collection via Helius DAS
 * (`getAssetsByGroup`). Used to build auto-WL allowlists from on-chain collections
 * (Gen1 owls, Owltopia coin NFTs, etc.). Mainnet only.
 *
 * Returns a sorted, de-duplicated list of owner wallet addresses (burnt assets excluded).
 */
export async function scanCollectionHolders(
  collectionAddress: string,
  heliusApiKey: string
): Promise<{ wallets: string[]; assetsScanned: number }> {
  const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusApiKey)}`
  const owners = new Set<string>()
  const seenAssets = new Set<string>()
  let assetsScanned = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `coin-holder-scan-${page}`,
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
    if (!res.ok) throw new Error(`DAS getAssetsByGroup failed (HTTP ${res.status})`)

    const json: { error?: { message?: string }; result?: { items?: unknown[] } } = await res
      .json()
      .catch(() => ({}))
    if (json.error) throw new Error(`DAS getAssetsByGroup error: ${json.error.message ?? 'unknown'}`)

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
      owners.add(owner)
      assetsScanned++
    }

    if (items.length < PAGE_LIMIT) break
  }

  return { wallets: [...owners].sort(), assetsScanned }
}
