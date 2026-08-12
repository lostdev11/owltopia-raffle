/**
 * Raffle URL slugs — keep them boring so they don’t twin classic NFT phishing paths
 * like `/raffles/legendary-dragon-nft`.
 */

const SLUG_MAX = 100

/** Whole hyphen-separated segments stripped from auto-generated slugs. */
const BLOCKED_SEGMENTS = new Set([
  'legendary',
  'dragon',
  'metamask',
  'airdrop',
  'freemint',
  'whitelistclaim',
])

/**
 * Multi-segment phishing-shaped phrases removed before segment filtering.
 * Matched as hyphenated substrings on the slug.
 */
const BLOCKED_PHRASES = [
  'free-mint',
  'mint-now',
  'connect-wallet',
  'claim-now',
  'wl-claim',
  'bonus-claim',
  'giveaway-claim',
  'free-nft',
  'claim-nft',
  'nft-claim',
  'dragon-nft',
  'legendary-dragon',
] as const

function collapseHyphens(slug: string): string {
  return slug.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
}

/** Basic title → kebab slug (no phishing filtering). */
export function basicSlugifyTitle(title: string): string {
  return collapseHyphens(
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
  ).slice(0, SLUG_MAX)
}

/**
 * Strip phishing-adjacent tokens from an already-kebab slug.
 * Empty result falls back to `raffle`.
 */
export function sanitizeRaffleSlug(rawSlug: string): string {
  let slug = collapseHyphens(rawSlug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'))

  for (const phrase of BLOCKED_PHRASES) {
    slug = collapseHyphens(slug.split(phrase).join('-'))
  }

  const parts = slug.split('-').filter((p) => p.length > 0 && !BLOCKED_SEGMENTS.has(p))
  slug = collapseHyphens(parts.join('-')).slice(0, SLUG_MAX)

  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return 'raffle'
  }
  return slug
}

/** Title → unique-ready base slug with scam-like tokens removed. */
export function slugifyRaffleTitle(title: string): string {
  return sanitizeRaffleSlug(basicSlugifyTitle(title))
}
