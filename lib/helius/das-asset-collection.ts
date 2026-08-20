/**
 * Whether a Helius DAS asset (getAsset / getAssetsByOwner item) belongs to a collection address.
 * Shared by holder checks and nesting wallet picks.
 */
export function dasAssetBelongsToCollection(item: unknown, collectionAddress: string): boolean {
  if (!collectionAddress) return false
  if (!item || typeof item !== 'object') return false
  const o = item as Record<string, unknown>

  const grouping = o.grouping
  if (Array.isArray(grouping)) {
    // Match collection pubkey on group_value (TM `collection`, Metaplex Core, etc.; group_key varies).
    const inGroupedCollection = grouping.some(
      (g: unknown) =>
        g &&
        typeof g === 'object' &&
        typeof (g as { group_value?: string }).group_value === 'string' &&
        (g as { group_value: string }).group_value === collectionAddress,
    )
    if (inGroupedCollection) return true
  }

  const topCol = o.collection
  if (topCol && typeof topCol === 'object') {
    const key = (topCol as { key?: string; address?: string }).key
    const addr = (topCol as { key?: string; address?: string }).address
    if (typeof key === 'string' && key === collectionAddress) return true
    if (typeof addr === 'string' && addr === collectionAddress) return true
  }

  const content = o.content
  if (content && typeof content === 'object') {
    const metadata = (content as { metadata?: { collection?: { key?: string; verified?: boolean } } }).metadata
    const key = metadata?.collection?.key
    if (typeof key === 'string' && key === collectionAddress) return true
  }

  return false
}

function trimPubkeyCandidate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t.length >= 32 ? t : null
}

/**
 * On-chain collection mint from a Helius DAS `getAsset` / `getAssetsByOwner` item.
 * Prefers verified grouping (`group_key === 'collection'`), then other grouping values, then metadata.
 */
export function extractDasAssetCollectionMint(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, unknown>

  const topCol = o.collection
  if (topCol && typeof topCol === 'object') {
    const fromAddr = trimPubkeyCandidate((topCol as { address?: string }).address)
    if (fromAddr) return fromAddr
    const fromKey = trimPubkeyCandidate((topCol as { key?: string }).key)
    if (fromKey) return fromKey
  }

  const grouping = o.grouping
  if (Array.isArray(grouping)) {
    for (const g of grouping) {
      if (!g || typeof g !== 'object') continue
      const gv = trimPubkeyCandidate((g as { group_value?: string }).group_value)
      const gk = (g as { group_key?: string }).group_key
      if (gv && gk === 'collection') return gv
    }
    for (const g of grouping) {
      if (!g || typeof g !== 'object') continue
      const gv = trimPubkeyCandidate((g as { group_value?: string }).group_value)
      if (gv) return gv
    }
  }

  const content = o.content
  if (content && typeof content === 'object') {
    const metadata = (content as { metadata?: { collection?: { key?: string } } }).metadata
    const fromMeta = trimPubkeyCandidate(metadata?.collection?.key)
    if (fromMeta) return fromMeta
  }

  return null
}

function trimName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t ? t : null
}

/** Collection display name from DAS when Helius includes collection metadata. */
export function extractDasAssetCollectionName(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, unknown>
  const topCol = o.collection
  if (topCol && typeof topCol === 'object') {
    const n = trimName((topCol as { name?: string }).name)
    if (n) return n
  }
  const grouping = o.grouping
  if (Array.isArray(grouping)) {
    for (const g of grouping) {
      if (!g || typeof g !== 'object') continue
      const meta = (g as { collection_metadata?: { name?: string } }).collection_metadata
      const n = trimName(meta?.name)
      if (n) return n
    }
  }
  const content = o.content
  if (content && typeof content === 'object') {
    const metadata = (content as { metadata?: { collection?: { name?: string } } }).metadata
    const n = trimName(metadata?.collection?.name)
    if (n) return n
  }
  return null
}
