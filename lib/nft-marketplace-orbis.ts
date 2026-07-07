import { orbisNftUrl } from '@/lib/nft-marketplace-links'

const ORBIS_LOOKUP_URL = 'https://www.orbisonsol.io/api/marketplace'

type OrbisLookupMintResponse = {
  success?: boolean
  found?: boolean
  collectionPathname?: string
}

export type OrbisMintLookupResult =
  | { found: true; url: string; collectionPathname: string }
  | { found: false; url: null }

/**
 * Resolve a direct Orbis item URL when the mint is indexed.
 * Uses /marketplace/item/{mint} so Orbis SSR opens item-only mode (not collection + modal).
 */
export async function lookupOrbisNftUrl(mint: string): Promise<OrbisMintLookupResult> {
  const m = mint.trim()
  if (!m) return { found: false, url: null }

  try {
    const res = await fetch(ORBIS_LOOKUP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lookupMint', mint: m }),
      next: { revalidate: 3600 },
    })
    const data = (await res.json()) as OrbisLookupMintResponse

    if (data.success && data.found && data.collectionPathname?.trim()) {
      return {
        found: true,
        collectionPathname: data.collectionPathname.trim(),
        url: orbisNftUrl(m),
      }
    }
  } catch {
    /* fall through */
  }

  return { found: false, url: null }
}
