/** Normalized referral codes: lowercase [a-z0-9_-], length bounds. */

export const REFERRAL_CODE_MIN_LEN = 3
export const REFERRAL_CODE_MAX_LEN = 32

const RESERVED_SLUGS = new Set(
  [
    'admin',
    'api',
    'auth',
    'dashboard',
    'discord',
    'help',
    'me',
    'mod',
    'null',
    'owl',
    'raffles',
    'ref',
    'support',
    'verify',
    'www',
  ].map((s) => s.toLowerCase())
)

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/

export function normalizeReferralCodeInput(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const s = String(raw).trim().toLowerCase()
  if (s.length < REFERRAL_CODE_MIN_LEN || s.length > REFERRAL_CODE_MAX_LEN) return null
  if (!SAFE_SEGMENT.test(s)) return null
  return s
}

export function isReservedReferralSlug(normalized: string): boolean {
  return RESERVED_SLUGS.has(normalized)
}

export function normalizeVanitySlugForSet(raw: string | null | undefined): string | null {
  return normalizeReferralCodeInput(raw)
}
