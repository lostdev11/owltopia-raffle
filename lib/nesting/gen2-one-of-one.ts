import {
  arweaveTxIdFromHttps,
  normalizeOwlCenterArweaveGatewayUri,
  walletSafeArweaveGatewayUri,
} from '@/lib/owl-center/arweave-gateway-uri'
import { irysGatewayMirrorHttpsUrls, isIrysGatewayHttpsUrl } from '@/lib/nft-media-uri'
import { fetchDasAssetBatchFromHelius } from '@/lib/nft-helius-image'
import { GEN2_ONE_OF_ONE_MINTS } from '@/lib/nesting/gen2-one-of-one-mints'

export type Gen2RevShareBucket = 'standard' | 'one-of-one'

/** Gen 2 1/1 owls carry a metadata trait whose type is literally `1/1`. */
export const DEFAULT_GEN2_ONE_OF_ONE_TRAIT_TYPE = '1/1'

const METADATA_JSON_TIMEOUT_MS = 3_500
const JSON_FALLBACK_CONCURRENCY = 4

function parseGen2OneOfOneTraitType(): string {
  return process.env.GEN2_ONE_OF_ONE_TRAIT_TYPE?.trim() || DEFAULT_GEN2_ONE_OF_ONE_TRAIT_TYPE
}

function normalizeTraitKey(value: string): string {
  return value.trim().toLowerCase()
}

/** Committed Gen 2 1/1 mints + optional `GEN2_ONE_OF_ONE_MINTS` env overrides. */
export function gen2OneOfOneMintAllowlist(): Set<string> {
  const out = new Set<string>(GEN2_ONE_OF_ONE_MINTS)
  const raw = process.env.GEN2_ONE_OF_ONE_MINTS?.trim()
  if (!raw) return out
  for (const part of raw.split(/[,\s]+/)) {
    const mint = part.trim()
    if (mint) out.add(mint)
  }
  return out
}

export function mintIsGen2OneOfOneAllowlisted(mint: string | null | undefined): boolean {
  const id = mint?.trim()
  if (!id) return false
  return gen2OneOfOneMintAllowlist().has(id)
}

export function pickAttributesFromRecords(
  attrs: unknown
): Array<{ trait_type: string; value: string }> {
  if (!Array.isArray(attrs)) return []
  const out: Array<{ trait_type: string; value: string }> = []
  for (const row of attrs) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const traitType =
      typeof rec.trait_type === 'string'
        ? rec.trait_type
        : typeof rec.traitType === 'string'
          ? rec.traitType
          : ''
    const value =
      typeof rec.value === 'string'
        ? rec.value
        : rec.value != null
          ? String(rec.value)
          : ''
    if (!traitType.trim() || !value.trim()) continue
    out.push({ trait_type: traitType.trim(), value: value.trim() })
  }
  return out
}

export function pickAttributesFromDasAsset(result: unknown): Array<{ trait_type: string; value: string }> {
  if (!result || typeof result !== 'object') return []
  const content = (result as Record<string, unknown>).content as Record<string, unknown> | undefined
  const metadata = content?.metadata as Record<string, unknown> | undefined
  return pickAttributesFromRecords(metadata?.attributes)
}

export function extractJsonUriFromDasAsset(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const content = (result as Record<string, unknown>).content as Record<string, unknown> | undefined
  if (!content) return null
  const ju = content.json_uri ?? content.jsonUri
  return typeof ju === 'string' && ju.trim() ? ju.trim() : null
}

export function attrsHaveGen2OneOfOneTrait(
  attrs: Array<{ trait_type: string; value: string }>
): boolean {
  const target = normalizeTraitKey(parseGen2OneOfOneTraitType())
  return attrs.some((attr) => normalizeTraitKey(attr.trait_type) === target)
}

/** True when off-chain metadata JSON carries the Gen 2 `1/1` trait. */
export function metadataJsonHasGen2OneOfOneTrait(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false
  const attrs = pickAttributesFromRecords((json as Record<string, unknown>).attributes)
  return attrsHaveGen2OneOfOneTrait(attrs)
}

function metadataJsonFetchCandidates(uri: string): string[] {
  const trimmed = uri.trim()
  if (!trimmed) return []
  const mirrors = new Set<string>([trimmed])
  if (isIrysGatewayHttpsUrl(trimmed)) {
    for (const m of irysGatewayMirrorHttpsUrls(trimmed)) mirrors.add(m)
  }
  const id = arweaveTxIdFromHttps(trimmed)
  if (id) {
    mirrors.add(walletSafeArweaveGatewayUri(trimmed))
    mirrors.add(normalizeOwlCenterArweaveGatewayUri(trimmed))
  }
  return [...mirrors]
}

async function fetchMetadataJson(jsonUri: string): Promise<unknown | null> {
  for (const url of metadataJsonFetchCandidates(jsonUri)) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), METADATA_JSON_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json, text/plain;q=0.9,*/*;q=0.8' },
      })
      if (!res.ok) continue
      const data: unknown = await res.json().catch(() => null)
      if (data && typeof data === 'object') return data
    } catch {
      /* try next gateway */
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/** Sync check: allowlist or inline DAS attributes only (no json_uri fetch). */
export function isGen2OneOfOneFromDasAsset(mint: string, result: unknown): boolean {
  const id = mint.trim()
  if (!id) return false
  if (mintIsGen2OneOfOneAllowlisted(id)) return true
  return attrsHaveGen2OneOfOneTrait(pickAttributesFromDasAsset(result))
}

async function isGen2OneOfOneWithJsonFallback(mint: string, result: unknown): Promise<boolean> {
  if (isGen2OneOfOneFromDasAsset(mint, result)) return true

  const dasAttrs = pickAttributesFromDasAsset(result)
  // Only hit Arweave when DAS omitted attributes (sparse indexer rows).
  if (dasAttrs.length > 0) return false

  const jsonUri = extractJsonUriFromDasAsset(result)
  if (!jsonUri) return false
  const json = await fetchMetadataJson(jsonUri)
  return metadataJsonHasGen2OneOfOneTrait(json)
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      if (item === undefined) return
      await fn(item)
    }
  })
  await Promise.all(workers)
}

/**
 * Classify many Gen 2 mints:
 * 1) committed + env allowlist
 * 2) Helius DAS inline attributes
 * 3) json_uri attributes when DAS attrs are empty
 *
 * Unknown / failed lookups → standard.
 */
export async function classifyGen2OneOfOneMints(mints: string[]): Promise<Map<string, Gen2RevShareBucket>> {
  const unique = [...new Set(mints.map((m) => m.trim()).filter(Boolean))]
  const out = new Map<string, Gen2RevShareBucket>()
  if (!unique.length) return out

  const allowlist = gen2OneOfOneMintAllowlist()
  const pending: string[] = []
  for (const mint of unique) {
    if (allowlist.has(mint)) {
      out.set(mint, 'one-of-one')
    } else {
      pending.push(mint)
    }
  }

  if (!pending.length) return out

  const payloads = await fetchDasAssetBatchFromHelius(pending, { preferMainnet: true })
  const needJsonFallback: string[] = []

  for (const mint of pending) {
    const payload = payloads.get(mint)
    if (isGen2OneOfOneFromDasAsset(mint, payload)) {
      out.set(mint, 'one-of-one')
      continue
    }
    const dasAttrs = pickAttributesFromDasAsset(payload)
    if (dasAttrs.length === 0 && extractJsonUriFromDasAsset(payload)) {
      needJsonFallback.push(mint)
    } else {
      out.set(mint, 'standard')
    }
  }

  if (needJsonFallback.length) {
    await mapWithConcurrency(needJsonFallback, JSON_FALLBACK_CONCURRENCY, async (mint) => {
      const payload = payloads.get(mint)
      const isOoo = await isGen2OneOfOneWithJsonFallback(mint, payload)
      out.set(mint, isOoo ? 'one-of-one' : 'standard')
    })
  }

  return out
}

export function bucketForGen2Mint(
  mint: string | null | undefined,
  classification: Map<string, Gen2RevShareBucket>
): Gen2RevShareBucket {
  const id = mint?.trim()
  if (!id) return 'standard'
  return classification.get(id) ?? 'standard'
}
