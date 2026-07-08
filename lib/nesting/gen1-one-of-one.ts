import { DEFAULT_ONE_OF_ONE_TRAIT_TYPE } from '@/lib/owl-center/generator/one-of-one'
import { fetchDasAssetBatchFromHelius } from '@/lib/nft-helius-image'

export type Gen1RevShareBucket = 'standard' | 'one-of-one'

function parseGen1OneOfOneTraitType(): string {
  return process.env.GEN1_ONE_OF_ONE_TRAIT_TYPE?.trim() || DEFAULT_ONE_OF_ONE_TRAIT_TYPE
}

function gen1OneOfOneMintAllowlist(): Set<string> {
  const raw = process.env.GEN1_ONE_OF_ONE_MINTS?.trim()
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

/** Gen 1 1/1 owls carry a `Special` metadata trait (e.g. Special: The Widow King). */
export function isGen1OneOfOneFromDasAsset(mint: string, result: unknown): boolean {
  const id = mint.trim()
  if (!id) return false
  if (gen1OneOfOneMintAllowlist().has(id)) return true

  const traitType = parseGen1OneOfOneTraitType()
  const target = normalizeTraitKey(traitType)
  return pickAttributesFromDasAsset(result).some(
    (attr) => normalizeTraitKey(attr.trait_type) === target
  )
}

/** Classify many Gen 1 mints via Helius DAS (mainnet). Unknown / failed lookups → standard. */
export async function classifyGen1OneOfOneMints(mints: string[]): Promise<Map<string, Gen1RevShareBucket>> {
  const unique = [...new Set(mints.map((m) => m.trim()).filter(Boolean))]
  const out = new Map<string, Gen1RevShareBucket>()
  if (!unique.length) return out

  const allowlist = gen1OneOfOneMintAllowlist()
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
      out.set(mint, isGen1OneOfOneFromDasAsset(mint, payload) ? 'one-of-one' : 'standard')
    }
  }

  return out
}

export function bucketForGen1Mint(
  mint: string | null | undefined,
  classification: Map<string, Gen1RevShareBucket>
): Gen1RevShareBucket {
  const id = mint?.trim()
  if (!id) return 'standard'
  return classification.get(id) ?? 'standard'
}
