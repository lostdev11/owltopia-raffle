import { dasAssetBelongsToCollection } from '@/lib/helius/das-asset-collection'

/** Minimal DAS asset shape for nesting wallet picker + metadata display. */
export type HeliusDasNftItem = {
  id?: string
  burnt?: boolean
  grouping?: Array<{ group_key?: string; group_value?: string }>
  ownership?: { owner?: string }
  content?: {
    json_uri?: string
    metadata?: { name?: string; collection?: { key?: string } }
    files?: Array<{ uri?: string; cdn_uri?: string }>
  }
}

/**
 * Flags Helius accepts under `displayOptions` (official DAS docs).
 * Also mirrored under `options` — some deployments/routes still honor the legacy key.
 */
function dasOwnerDisplayFlags(): Record<string, boolean> {
  return {
    showFungible: false,
    showGrandTotal: false,
    showInscription: false,
    showNativeBalance: false,
    showZeroBalance: false,
    showUnverifiedCollections: true,
  }
}

/**
 * Wallet-held NFTs that belong to `collectionAddress`, merged from:
 * - `searchAssets` (owner + collection grouping) — hits are trusted without re-checking `grouping` on each item
 *   (Helius often omits grouping on sparse rows; `dasAssetBelongsToCollection` would drop everything).
 * - `getAssetsByOwner` — page scan with `displayOptions` (per Helius docs) + legacy `options`
 * - `getAssetsByGroup` — only if still empty: paginate collection, keep rows owned by `wallet`
 *
 * Use **mainnet** Helius when the collection lives on mainnet (see `getHeliusMainnetRpcUrl`).
 */
export async function fetchWalletNftsInCollectionDas(
  heliusRpcUrl: string,
  wallet: string,
  collectionAddress: string
): Promise<HeliusDasNftItem[]> {
  const byId = new Map<string, HeliusDasNftItem>()
  const limit = 1000
  const maxPages = 40
  const display = dasOwnerDisplayFlags()
  const tokenTypes = ['all', 'nonFungible', 'compressedNft', 'regularNft'] as const

  // --- searchAssets (collection constraint is server-side; do not require grouping on each item)
  for (const tokenType of tokenTypes) {
    for (let page = 1; page <= maxPages; page++) {
      const res = await fetch(heliusRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `nesting-coll-search-${tokenType}-${page}`,
          method: 'searchAssets',
          params: {
            ownerAddress: wallet,
            tokenType,
            page,
            limit,
            burnt: false,
            grouping: ['collection', collectionAddress],
            options: {
              showUnverifiedCollections: true,
            },
          },
        }),
        cache: 'no-store',
      })
      if (!res.ok) break

      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string }
        result?: { items?: HeliusDasNftItem[] }
      }
      if (json.error) break

      const items = json.result?.items
      if (!Array.isArray(items) || items.length === 0) break

      for (const item of items) {
        const id = item.id?.trim()
        if (!id || item.burnt === true) continue
        const owner = item.ownership?.owner?.trim()
        if (!owner || owner !== wallet) continue
        byId.set(id, item)
      }

      if (items.length < limit) break
    }
  }

  const matchesCollection = (item: HeliusDasNftItem) =>
    dasAssetBelongsToCollection(item, collectionAddress)

  // --- getAssetsByOwner (page — documented pagination + displayOptions for grouping fields)
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(heliusRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `nesting-coll-owner-page-${page}`,
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: wallet,
          page,
          limit,
          displayOptions: display,
          options: display,
        },
      }),
      cache: 'no-store',
    })
    if (!res.ok) break

    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string }
      result?: { items?: HeliusDasNftItem[] }
    }
    if (json.error) break

    const items = json.result?.items
    if (!Array.isArray(items) || items.length === 0) break

    for (const item of items) {
      const id = item.id?.trim()
      if (!id || item.burnt === true) continue
      if (!matchesCollection(item)) continue
      byId.set(id, item)
    }

    if (items.length < limit) break
  }

  // --- Last resort: paginate the collection and pick this owner's assets (expensive for huge mint counts — only if still empty).
  if (byId.size === 0) {
    const groupMaxPages = 30
    for (let page = 1; page <= groupMaxPages; page++) {
      const res = await fetch(heliusRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `nesting-coll-group-${page}`,
          method: 'getAssetsByGroup',
          params: {
            groupKey: 'collection',
            groupValue: collectionAddress,
            page,
            limit,
            options: display,
          },
        }),
        cache: 'no-store',
      })
      if (!res.ok) break

      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string }
        result?: { items?: HeliusDasNftItem[] }
      }
      if (json.error) break

      const items = json.result?.items
      if (!Array.isArray(items) || items.length === 0) break

      for (const item of items) {
        const id = item.id?.trim()
        if (!id || item.burnt === true) continue
        const owner = item.ownership?.owner?.trim()
        if (owner !== wallet) continue
        byId.set(id, item)
      }

      if (items.length < limit) break
    }
  }

  return [...byId.values()]
}
