/**
 * Raffle URL slugs — keep them boring so they don’t twin classic NFT phishing paths
 * like `/raffles/legendary-dragon-nft`.
 */

import { stripPhishingShapedSlug } from '@/lib/slugs/phishing-shaped'

const SLUG_MAX = 100

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
  const slug = stripPhishingShapedSlug(rawSlug).slice(0, SLUG_MAX)

  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return 'raffle'
  }
  return slug
}

/** Title → unique-ready base slug with scam-like tokens removed. */
export function slugifyRaffleTitle(title: string): string {
  return sanitizeRaffleSlug(basicSlugifyTitle(title))
}
