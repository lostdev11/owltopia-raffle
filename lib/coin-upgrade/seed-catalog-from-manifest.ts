import 'server-only'

import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { resolveOwltopiaCoinCollectionAddress } from '@/lib/coin-upgrade/collection'
import { upsertCoinArtUpgradeCatalogRows } from '@/lib/db/coin-art-upgrade-upload-jobs'

const PAGE_SIZE = 1000

type DasAsset = {
  id?: string
  burnt?: boolean
  content?: {
    json_uri?: string
    metadata?: { name?: string }
  }
}

function coinNumberFromName(name: string | null | undefined): number | null {
  const m = /#\s*(\d+)/.exec(name ?? '')
  if (m) return Number.parseInt(m[1]!, 10)
  const tail = /(\d+)\s*$/.exec(name ?? '')
  return tail ? Number.parseInt(tail[1]!, 10) : null
}

async function fetchCollectionAssets(collection: string): Promise<DasAsset[]> {
  const heliusUrl = getHeliusMainnetRpcUrl()
  if (!heliusUrl) throw new Error('HELIUS_API_KEY is required to map coin numbers to asset ids.')

  const assets: DasAsset[] = []
  for (let page = 1; ; page += 1) {
    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'coin-art-upgrade-catalog-seed',
        method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: collection, page, limit: PAGE_SIZE },
      }),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Helius getAssetsByGroup failed (HTTP ${res.status}).`)
    const json = (await res.json()) as {
      result?: { items?: DasAsset[] }
      error?: { message?: string }
    }
    if (json.error) throw new Error(`Helius error: ${json.error.message ?? 'unknown'}`)
    const items = json.result?.items ?? []
    assets.push(...items)
    if (items.length < PAGE_SIZE) break
  }
  return assets
}

export type SeedCatalogResult = {
  upserted: number
  skipped: number
  problems: {
    noNumber: number
    noArt: number
    duplicateNumber: number
  }
}

/**
 * Join Irys upload manifest (coin number → URIs) with on-chain Owltopia coins
 * and upsert `coin_art_upgrade_catalog`. Same logic as scripts/seed-coin-upgrade-catalog.mjs.
 */
export async function seedCoinArtUpgradeCatalogFromManifest(
  manifest: Record<string, { image?: string; metadata: string }>
): Promise<SeedCatalogResult> {
  const collection = resolveOwltopiaCoinCollectionAddress()
  const assets = await fetchCollectionAssets(collection)

  const rows: Array<{
    asset_id: string
    coin_number: number
    name: string | null
    new_uri: string
    new_image_uri: string | null
    original_uri: string | null
  }> = []
  const problems = { noNumber: 0, noArt: 0, duplicateNumber: 0 }
  const seenNumbers = new Map<number, string>()

  for (const asset of assets) {
    if (asset.burnt === true) continue
    const assetId = asset.id?.trim()
    if (!assetId) continue
    const name = asset.content?.metadata?.name ?? null
    const n = coinNumberFromName(name)
    if (n == null) {
      problems.noNumber += 1
      continue
    }
    if (seenNumbers.has(n)) {
      problems.duplicateNumber += 1
      continue
    }
    seenNumbers.set(n, assetId)
    const art = manifest[String(n)]
    if (!art?.metadata) {
      problems.noArt += 1
      continue
    }
    rows.push({
      asset_id: assetId,
      coin_number: n,
      name,
      new_uri: art.metadata,
      new_image_uri: art.image ?? null,
      original_uri: asset.content?.json_uri ?? null,
    })
  }

  const upserted = await upsertCoinArtUpgradeCatalogRows(rows)
  return {
    upserted,
    skipped: problems.noNumber + problems.noArt + problems.duplicateNumber,
    problems,
  }
}
