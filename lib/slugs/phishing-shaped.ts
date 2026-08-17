/**
 * Tokens stripped from public URL slugs so paths don’t twin classic NFT phishing
 * links (e.g. `/…/legendary-dragon-nft`, `/…/free-mint-airdrop`).
 */

/** Whole hyphen-separated segments removed from auto-generated slugs. */
export const PHISHING_SHAPED_SLUG_SEGMENTS = new Set([
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
export const PHISHING_SHAPED_SLUG_PHRASES = [
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

/**
 * Strip phishing-adjacent tokens from a kebab (or title-like) slug.
 * May return an empty string — callers supply their own fallback.
 */
export function stripPhishingShapedSlug(rawSlug: string): string {
  let slug = collapseHyphens(rawSlug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'))

  for (const phrase of PHISHING_SHAPED_SLUG_PHRASES) {
    slug = collapseHyphens(slug.split(phrase).join('-'))
  }

  const parts = slug.split('-').filter((p) => p.length > 0 && !PHISHING_SHAPED_SLUG_SEGMENTS.has(p))
  return collapseHyphens(parts.join('-'))
}
