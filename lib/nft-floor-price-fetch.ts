/**
 * NFT collection floor lookup across Tensor, Orbis, and Magic Eden.
 * Display / suggestion only — never mutates raffle ticket economics.
 *
 * Priority: Tensor → Orbis → Magic Eden (first successful source wins).
 * Tensor / Orbis need API keys; Magic Eden is the no-key fallback.
 */

import { lookupOrbisNftUrl } from '@/lib/nft-marketplace-orbis'

export type NftMarketFloorSource = 'tensor' | 'orbis' | 'magic_eden' | 'none'

export type NftMarketFloorResult = {
  ok: true
  floorSol: number
  source: Exclude<NftMarketFloorSource, 'none'>
  collectionSymbol: string | null
  collectionName: string | null
  /** Other sources that also returned a floor (for debugging / UI hints). */
  alsoSeen?: Array<{ source: Exclude<NftMarketFloorSource, 'none'>; floorSol: number }>
}

export type NftMarketFloorMiss = {
  ok: false
  source: 'none'
  reason: string
  collectionSymbol: string | null
  collectionName: string | null
  tried?: NftMarketFloorSource[]
}

const ME_API_BASE = 'https://api-mainnet.magiceden.dev/v2'
const TENSOR_API_BASE = 'https://api.mainnet.tensordev.io/api/v1'
const ORBIS_MP_PUBLIC = 'https://www.orbisonsol.io/api/mp-public'
const FETCH_TIMEOUT_MS = 10_000
const LAMPORTS_PER_SOL = 1_000_000_000

/** In-process cache keyed by mint. */
const floorCache = new Map<string, { expiresAt: number; value: NftMarketFloorResult | NftMarketFloorMiss }>()
const CACHE_TTL_MS = 60_000

function cacheGet(key: string): NftMarketFloorResult | NftMarketFloorMiss | null {
  const hit = floorCache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    floorCache.delete(key)
    return null
  }
  return hit.value
}

function cacheSet(key: string, value: NftMarketFloorResult | NftMarketFloorMiss): void {
  floorCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value })
}

function parsePositiveNumber(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Normalize marketplace floor amounts that may be lamports or SOL. */
export function normalizeFloorAmountToSol(floorPrice: number): number | null {
  if (!Number.isFinite(floorPrice) || floorPrice <= 0) return null
  const sol = floorPrice >= 1_000 ? floorPrice / LAMPORTS_PER_SOL : floorPrice
  if (!Number.isFinite(sol) || sol <= 0 || sol > 1e9) return null
  return Math.round(sol * 1e9) / 1e9
}

/** @deprecated Prefer {@link normalizeFloorAmountToSol}. */
export function magicEdenFloorToSol(floorPrice: number): number | null {
  return normalizeFloorAmountToSol(floorPrice)
}

function tensorApiKey(): string | null {
  const k =
    process.env.TENSOR_API_KEY?.trim() ||
    process.env.TENSOR_API_KEY_MAINNET?.trim() ||
    process.env.X_TENSOR_API_KEY?.trim() ||
    ''
  return k || null
}

function orbisApiKey(): string | null {
  const k =
    process.env.ORBIS_API_KEY?.trim() ||
    process.env.ORBIS_MP_API_KEY?.trim() ||
    process.env.ORBIS_PUBLIC_API_KEY?.trim() ||
    ''
  return k || null
}

async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<{ ok: true; json: unknown } | { ok: false; status: number | null }> {
  try {
    const res = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, status: res.status }
    const json = await res.json().catch(() => null)
    if (json == null) return { ok: false, status: res.status }
    return { ok: true, json }
  } catch {
    return { ok: false, status: null }
  }
}

type SourceHit = {
  floorSol: number
  source: Exclude<NftMarketFloorSource, 'none'>
  collectionSymbol: string | null
  collectionName: string | null
}

export type MeTokenCollection = {
  collectionSymbol: string | null
  collectionName: string | null
}

/** Resolve Magic Eden collection symbol for a mint. */
export async function resolveMagicEdenCollectionForMint(mint: string): Promise<MeTokenCollection> {
  const m = mint.trim()
  if (!m) return { collectionSymbol: null, collectionName: null }
  const result = await fetchJson(`${ME_API_BASE}/tokens/${encodeURIComponent(m)}`, {
    headers: { Accept: 'application/json' },
  })
  if (!result.ok || !result.json || typeof result.json !== 'object') {
    return { collectionSymbol: null, collectionName: null }
  }
  const row = result.json as Record<string, unknown>
  const symbolRaw = row.collection ?? row.collectionSymbol
  const nameRaw = row.collectionName
  const collectionSymbol =
    typeof symbolRaw === 'string' && symbolRaw.trim() ? symbolRaw.trim() : null
  const collectionName = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : null
  return { collectionSymbol, collectionName }
}

export async function fetchMagicEdenCollectionFloorSol(
  collectionSymbol: string
): Promise<number | null> {
  const symbol = collectionSymbol.trim()
  if (!symbol) return null
  const result = await fetchJson(`${ME_API_BASE}/collections/${encodeURIComponent(symbol)}/stats`, {
    headers: { Accept: 'application/json' },
  })
  if (!result.ok || !result.json || typeof result.json !== 'object') return null
  const floorRaw = (result.json as Record<string, unknown>).floorPrice
  const floorN = parsePositiveNumber(floorRaw)
  if (floorN == null) return null
  return normalizeFloorAmountToSol(floorN)
}

async function fetchMagicEdenFloorForMint(
  mint: string,
  knownSymbol?: string | null
): Promise<SourceHit | null> {
  let collectionSymbol =
    typeof knownSymbol === 'string' && knownSymbol.trim() ? knownSymbol.trim() : null
  let collectionName: string | null = null
  if (!collectionSymbol) {
    const resolved = await resolveMagicEdenCollectionForMint(mint)
    collectionSymbol = resolved.collectionSymbol
    collectionName = resolved.collectionName
  }
  if (!collectionSymbol) return null
  const floorSol = await fetchMagicEdenCollectionFloorSol(collectionSymbol)
  if (floorSol == null) return null
  return { floorSol, source: 'magic_eden', collectionSymbol, collectionName }
}

/**
 * Tensor: mint → collection + floor (requires TENSOR_API_KEY).
 * Uses /mint?mints= then collection stats when needed.
 */
export async function fetchTensorFloorForMint(mint: string): Promise<SourceHit | null> {
  const key = tensorApiKey()
  if (!key) return null
  const m = mint.trim()
  if (!m) return null

  const mintRes = await fetchJson(`${TENSOR_API_BASE}/mint?mints=${encodeURIComponent(m)}`, {
    headers: { Accept: 'application/json', 'x-tensor-api-key': key },
  })
  if (!mintRes.ok) return null

  const payload = mintRes.json
  const row: Record<string, unknown> | null = Array.isArray(payload)
    ? ((payload[0] as Record<string, unknown> | undefined) ?? null)
    : payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : null
  if (!row) return null

  const coll =
    row.coll && typeof row.coll === 'object'
      ? (row.coll as Record<string, unknown>)
      : row.collection && typeof row.collection === 'object'
        ? (row.collection as Record<string, unknown>)
        : null

  const collectionSymbol =
    (typeof coll?.slugDisplay === 'string' && coll.slugDisplay.trim()) ||
    (typeof coll?.slug === 'string' && coll.slug.trim()) ||
    (typeof row.collId === 'string' && row.collId.trim()) ||
    (typeof row.collectionSlug === 'string' && row.collectionSlug.trim()) ||
    null

  const collectionName =
    (typeof coll?.name === 'string' && coll.name.trim()) ||
    (typeof row.collectionName === 'string' && row.collectionName.trim()) ||
    null

  // Prefer collection-level buy-now / floor from mint payload when present.
  const directCandidates = [
    row.collectionFloorPrice,
    row.floorPrice,
    row.buyNowPrice,
    coll?.floorPrice,
    coll?.buyNowPrice,
    (coll?.statsV2 as Record<string, unknown> | undefined)?.buyNowPrice,
    (coll?.stats as Record<string, unknown> | undefined)?.buyNowPrice,
  ]
  for (const c of directCandidates) {
    const n = parsePositiveNumber(c)
    if (n != null) {
      const floorSol = normalizeFloorAmountToSol(n)
      if (floorSol != null) {
        return { floorSol, source: 'tensor', collectionSymbol, collectionName }
      }
    }
  }

  if (!collectionSymbol) return null

  // Collection find / stats fallback
  const findRes = await fetchJson(
    `${TENSOR_API_BASE}/collections/find?query=${encodeURIComponent(collectionSymbol)}`,
    { headers: { Accept: 'application/json', 'x-tensor-api-key': key } }
  )
  if (findRes.ok) {
    const list = Array.isArray(findRes.json)
      ? findRes.json
      : findRes.json && typeof findRes.json === 'object' && Array.isArray((findRes.json as { collections?: unknown }).collections)
        ? ((findRes.json as { collections: unknown[] }).collections)
        : []
    const match =
      (list as Record<string, unknown>[]).find((c) => {
        const slug = String(c.slug ?? c.slugDisplay ?? '').toLowerCase()
        return slug === collectionSymbol.toLowerCase()
      }) ?? (list as Record<string, unknown>[])[0]
    if (match) {
      for (const c of [match.floorPrice, match.buyNowPrice, match.sellNowPrice]) {
        const n = parsePositiveNumber(c)
        if (n != null) {
          const floorSol = normalizeFloorAmountToSol(n)
          if (floorSol != null) {
            return {
              floorSol,
              source: 'tensor',
              collectionSymbol:
                (typeof match.slug === 'string' && match.slug) ||
                (typeof match.slugDisplay === 'string' && match.slugDisplay) ||
                collectionSymbol,
              collectionName:
                (typeof match.name === 'string' && match.name) || collectionName,
            }
          }
        }
      }
    }
  }

  return null
}

/**
 * Orbis: mint → collection pathname (public lookup) → floor via mp-public (ORBIS_API_KEY).
 */
export async function fetchOrbisFloorForMint(mint: string): Promise<SourceHit | null> {
  const key = orbisApiKey()
  if (!key) return null
  const m = mint.trim()
  if (!m) return null

  const lookup = await lookupOrbisNftUrl(m)
  if (!lookup.found) return null
  const pathname = lookup.collectionPathname.trim()
  if (!pathname) return null

  const collectionRes = await fetchJson(
    `${ORBIS_MP_PUBLIC}?action=collection&pathname=${encodeURIComponent(pathname)}`,
    { headers: { Accept: 'application/json', 'X-API-Key': key } }
  )

  let collectionName: string | null = null
  let floorSol: number | null = null

  if (collectionRes.ok && collectionRes.json && typeof collectionRes.json === 'object') {
    const root = collectionRes.json as Record<string, unknown>
    const data =
      root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root
    if (typeof data.name === 'string' && data.name.trim()) collectionName = data.name.trim()
    const stats =
      data.stats && typeof data.stats === 'object' ? (data.stats as Record<string, unknown>) : null
    const floorN = parsePositiveNumber(stats?.floorPrice ?? data.floorPrice)
    if (floorN != null) floorSol = normalizeFloorAmountToSol(floorN)
  }

  if (floorSol == null) {
    const statsRes = await fetchJson(
      `${ORBIS_MP_PUBLIC}?action=stats&pathname=${encodeURIComponent(pathname)}`,
      { headers: { Accept: 'application/json', 'X-API-Key': key } }
    )
    if (statsRes.ok && statsRes.json && typeof statsRes.json === 'object') {
      const root = statsRes.json as Record<string, unknown>
      const data =
        root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root
      const floorN = parsePositiveNumber(data.floorPrice)
      if (floorN != null) floorSol = normalizeFloorAmountToSol(floorN)
    }
  }

  if (floorSol == null) return null
  return {
    floorSol,
    source: 'orbis',
    collectionSymbol: pathname,
    collectionName,
  }
}

const SOURCE_PRIORITY: Array<Exclude<NftMarketFloorSource, 'none'>> = [
  'tensor',
  'orbis',
  'magic_eden',
]

/**
 * Look up collection floor in SOL for an NFT mint.
 * Tries Tensor → Orbis → Magic Eden (parallel where configured; picks by priority).
 */
export async function fetchNftMarketFloorByMint(
  mint: string,
  options?: { collectionSymbol?: string | null; bypassCache?: boolean }
): Promise<NftMarketFloorResult | NftMarketFloorMiss> {
  const m = mint.trim()
  if (!m) {
    return {
      ok: false,
      source: 'none',
      reason: 'mint is required',
      collectionSymbol: null,
      collectionName: null,
    }
  }

  const cacheKey = `mint:v2:${m}`
  if (options?.bypassCache !== true) {
    const cached = cacheGet(cacheKey)
    if (cached) return cached
  }

  const knownSymbol =
    typeof options?.collectionSymbol === 'string' && options.collectionSymbol.trim()
      ? options.collectionSymbol.trim()
      : null

  const tried: NftMarketFloorSource[] = []
  const jobs: Array<Promise<SourceHit | null>> = []

  if (tensorApiKey()) {
    tried.push('tensor')
    jobs.push(fetchTensorFloorForMint(m))
  }
  if (orbisApiKey()) {
    tried.push('orbis')
    jobs.push(fetchOrbisFloorForMint(m))
  }
  tried.push('magic_eden')
  jobs.push(fetchMagicEdenFloorForMint(m, knownSymbol))

  const settled = await Promise.all(jobs)
  const hits = settled.filter((h): h is SourceHit => h != null)

  if (hits.length === 0) {
    const miss: NftMarketFloorMiss = {
      ok: false,
      source: 'none',
      reason:
        tried.length <= 1
          ? 'No marketplace floor found (add TENSOR_API_KEY / ORBIS_API_KEY for better coverage)'
          : `No floor from tried sources: ${tried.join(', ')}`,
      collectionSymbol: knownSymbol,
      collectionName: null,
      tried,
    }
    cacheSet(cacheKey, miss)
    return miss
  }

  hits.sort(
    (a, b) => SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source)
  )
  const best = hits[0]!
  const alsoSeen = hits.slice(1).map((h) => ({ source: h.source, floorSol: h.floorSol }))

  const hit: NftMarketFloorResult = {
    ok: true,
    floorSol: best.floorSol,
    source: best.source,
    collectionSymbol: best.collectionSymbol,
    collectionName: best.collectionName,
    ...(alsoSeen.length ? { alsoSeen } : {}),
  }
  cacheSet(cacheKey, hit)
  return hit
}

/** Format SOL floor for UI (trim trailing zeros). */
export function formatMarketFloorSol(floorSol: number): string {
  if (!Number.isFinite(floorSol) || floorSol <= 0) return '—'
  const decimals = floorSol >= 100 ? 2 : floorSol >= 1 ? 4 : floorSol >= 0.01 ? 4 : 6
  return floorSol.toFixed(decimals).replace(/\.?0+$/, '')
}

export function marketFloorSourceLabel(source: string | null | undefined): string | null {
  switch (source) {
    case 'tensor':
      return 'Tensor'
    case 'orbis':
      return 'Orbis'
    case 'magic_eden':
      return 'Magic Eden'
    default:
      return null
  }
}
