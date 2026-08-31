import { fetchDasAssetBatchFromHelius } from '@/lib/nft-helius-image'

export type Gen2RevShareBucket = 'standard' | 'one-of-one'

/** Gen 2 1/1 owls carry a metadata trait whose type is literally `1/1`. */
export const DEFAULT_GEN2_ONE_OF_ONE_TRAIT_TYPE = '1/1'

function parseGen2OneOfOneTraitType(): string {
  return process.env.GEN2_ONE_OF_ONE_TRAIT_TYPE?.trim() || DEFAULT_GEN2_ONE_OF_ONE_TRAIT_TYPE
}

function gen2OneOfOneMintAllowlist(): Set<string> {
  const raw = process.env.GEN2_ONE_OF_ONE_MINTS?.trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

function normalizeTraitKey(value: string): string {
  return value.trim().toLowerCase()
}

function pickAttributesFromDasAsset(result: unknown): Array<{ trait_type: string; value: string }> {
  if (!result || typeof result !== 'object') return []
  const content = (result as Record<string, unknown>).content as Record<string, unknown> | undefined
  const metadata = content?.metadata as Record<string, unknown> | undefined
  const attrs = metadata?.attributes
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

/** Gen 2 1/1 owls carry a `1/1` metadata trait (e.g. 1/1: Water King). */
export function isGen2OneOfOneFromDasAsset(mint: string, result: unknown): boolean {
  const id = mint.trim()
  if (!id) return false
  if (gen2OneOfOneMintAllowlist().has(id)) return true

  const traitType = parseGen2OneOfOneTraitType()
  const target = normalizeTraitKey(traitType)
  return pickAttributesFromDasAsset(result).some(
    (attr) => normalizeTraitKey(attr.trait_type) === target
  )
}

/** Classify many Gen 2 mints via Helius DAS (mainnet). Unknown / failed lookups → standard. */
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

  if (pending.length) {
    const payloads = await fetchDasAssetBatchFromHelius(pending, { preferMainnet: true })
    for (const mint of pending) {
      const payload = payloads.get(mint)
      out.set(mint, isGen2OneOfOneFromDasAsset(mint, payload) ? 'one-of-one' : 'standard')
    }
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
