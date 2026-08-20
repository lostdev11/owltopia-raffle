import { basicSlugifyTitle } from '@/lib/raffles/slugify'

const SLUG_MAX = 80

/** Kebab slug for a collection, unique-ready via a short mint suffix. */
export function slugifyPlatformProject(displayName: string, collectionMint: string): string {
  const mint = collectionMint.trim()
  const suffix = mint.length >= 8 ? mint.slice(-6).toLowerCase() : mint.toLowerCase() || 'proj'
  const base = basicSlugifyTitle(displayName).slice(0, Math.max(8, SLUG_MAX - suffix.length - 1))
  const head = base || 'project'
  return `${head}-${suffix}`.slice(0, SLUG_MAX)
}
