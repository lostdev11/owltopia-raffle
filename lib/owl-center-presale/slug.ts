import { OWL_CENTER_PRESALE_SLUG_REGEX } from '@/lib/owl-center-presale/constants'

export function normalizeOwlCenterPresaleSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  if (!slug || !OWL_CENTER_PRESALE_SLUG_REGEX.test(slug)) return null
  return slug
}

export function owlCenterPresalePublicPath(slug: string): string {
  return `/owl-center/${encodeURIComponent(slug)}/presale`
}
