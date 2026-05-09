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
