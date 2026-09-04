import { orbisNftUrl } from '@/lib/nft-marketplace-links'

const ORBIS_LOOKUP_URL = 'https://www.orbisonsol.io/api/marketplace'
const ORBIS_PUBLIC_API = 'https://www.orbisonsol.io/api/mp-public'
const ORBIS_FLOOR_TIMEOUT_MS = 8_000

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
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ORBIS_FLOOR_TIMEOUT_MS)
    const res = await fetch(ORBIS_LOOKUP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lookupMint', mint: m }),
      next: { revalidate: 3600 },
      signal: controller.signal,
    })
    clearTimeout(timeout)
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

export function getOrbisApiKey(): string | null {
  return process.env.ORBIS_API_KEY?.trim() || null
}

export type OrbisFloorLookup = {
  floorSol: number
  listedCount: number | null
  collectionName: string | null
  pathname: string | null
}

function orbisPublicHeaders(): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const key = getOrbisApiKey()
  if (key) headers['X-API-Key'] = key
  return headers
}

function parseOrbisFloorSol(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  // Docs use SOL (e.g. 1.5). Treat lamports-scale numbers as 1e9 lamports/SOL.
  if (n >= 1_000_000) return n / 1_000_000_000
  return n
}

function parseOrbisListedCount(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

async function fetchOrbisPublicJson(url: string): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ORBIS_FLOOR_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: orbisPublicHeaders(),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function quoteFromOrbisPayload(payload: unknown, pathnameHint: string | null): OrbisFloorLookup | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  if (root.success === false) return null
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root
  const stats = data.stats && typeof data.stats === 'object' ? (data.stats as Record<string, unknown>) : null

  const floorSol = parseOrbisFloorSol(stats?.floorPrice ?? data.floorPrice)
  if (floorSol == null) return null

  const listedCount = parseOrbisListedCount(stats?.listed ?? data.listed)
  const collectionName =
    typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null
  const pathname =
    (typeof data.pathname === 'string' && data.pathname.trim()) || pathnameHint || null

  return { floorSol, listedCount, collectionName, pathname }
}

function quoteFromOrbisListings(payload: unknown, pathnameHint: string | null): OrbisFloorLookup | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  if (root.success === false) return null
  const rows = Array.isArray(root.data) ? root.data : Array.isArray(payload) ? payload : null
  const first = rows?.[0]
  if (!first || typeof first !== 'object') return null
  const floorSol = parseOrbisFloorSol((first as { priceSol?: unknown }).priceSol)
  if (floorSol == null) return null
  return {
    floorSol,
    listedCount: null,
    collectionName: null,
    pathname: pathnameHint,
  }
}

/**
 * Collection floor on Orbis (SOL). Requires `ORBIS_API_KEY` (`X-API-Key` for /api/mp-public).
 * Prefers `collectionAddress`; `pathname` is a fallback (from lookupMint).
 */
export async function lookupOrbisCollectionFloor(params: {
  collectionAddress?: string | null
  pathname?: string | null
}): Promise<OrbisFloorLookup | null> {
  if (!getOrbisApiKey()) return null
  const collectionAddress = params.collectionAddress?.trim() || null
  const pathname = params.pathname?.trim() || null
  if (!collectionAddress && !pathname) return null

  const urls: string[] = collectionAddress
    ? [
        `${ORBIS_PUBLIC_API}?action=stats&collectionAddress=${encodeURIComponent(collectionAddress)}`,
        `${ORBIS_PUBLIC_API}?action=collection&collectionAddress=${encodeURIComponent(collectionAddress)}`,
      ]
    : [
        `${ORBIS_PUBLIC_API}?action=collection&pathname=${encodeURIComponent(pathname!)}`,
        `${ORBIS_PUBLIC_API}?action=stats&pathname=${encodeURIComponent(pathname!)}`,
      ]

  const payloads = await Promise.all(urls.map((url) => fetchOrbisPublicJson(url)))
  for (const payload of payloads) {
    const quote = quoteFromOrbisPayload(payload, pathname)
    if (quote) return quote
  }

  if (collectionAddress && pathname) {
    const pathPayloads = await Promise.all([
      fetchOrbisPublicJson(
        `${ORBIS_PUBLIC_API}?action=collection&pathname=${encodeURIComponent(pathname)}`,
      ),
      fetchOrbisPublicJson(
        `${ORBIS_PUBLIC_API}?action=stats&pathname=${encodeURIComponent(pathname)}`,
      ),
    ])
    for (const payload of pathPayloads) {
      const quote = quoteFromOrbisPayload(payload, pathname)
      if (quote) return quote
    }
  }

  const listingQuery = new URLSearchParams({ action: 'listings', sort: 'priceLow', limit: '1' })
  if (collectionAddress) listingQuery.set('collectionAddress', collectionAddress)
  else if (pathname) listingQuery.set('pathname', pathname)
  const listings = await fetchOrbisPublicJson(`${ORBIS_PUBLIC_API}?${listingQuery.toString()}`)
  return quoteFromOrbisListings(listings, pathname)
}
