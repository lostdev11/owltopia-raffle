/** Helpers for the simplified Owl Nesting admin “quick create” NFT pool flow. */

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/

export function isProbableSolanaPubkey(raw: string): boolean {
  const s = raw.trim()
  if (s.length < 32 || s.length > 44) return false
  return BASE58_RE.test(s)
}

export function slugifyPoolSegment(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'pool'
}

/** Unique-ish slug: name-derived segment plus collection prefix (slug column is unique). */
export function suggestedNftPoolSlug(poolName: string, collectionMint: string): string {
  const coll = collectionMint.trim()
  const tail = coll.slice(0, 8).toLowerCase()
  return `${slugifyPoolSegment(poolName)}-${tail}`
}

export function buildQuickNftPoolDescription(params: {
  poolName: string
  collectionMint: string
  locked: boolean
  minLockDays: number
  maxLockDays: number
}): string {
  const name = params.poolName.trim()
  const mint = params.collectionMint.trim()
  const intro = `${name}: stake NFTs from collection ${mint} on Owltopia Nesting. OWL rewards follow the site emission policy (daily OWL per NFT).`
  if (!params.locked) {
    return `${intro} No mandatory lock period for this perch.`
  }
  return `${intro} Locked staking: unstaking is blocked until up to ${params.maxLockDays} days after stake (minimum intended commitment ${params.minLockDays} days—unlock timing follows the max lock days above).`
}
