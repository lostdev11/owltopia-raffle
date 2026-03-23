/**
 * Site/platform branding. When NEXT_PUBLIC_PLATFORM_NAME is set, it is used
 * everywhere the platform name appears (titles, metadata, footer, wallet app identity, etc.).
 */
const raw = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_PLATFORM_NAME?.trim()
export const PLATFORM_NAME = raw || 'Owl Raffle'

/** Default OG/twitter alt and tagline suffix. */
export const OG_TAGLINE = 'Trusted raffles with full transparency. Every entry verified on-chain.'
export const OG_ALT = `${PLATFORM_NAME} - ${OG_TAGLINE}`

/**
 * Default link-preview image path. Next serves `app/opengraph-image.tsx` here as PNG.
 * Prefer this over `public/og-image.png` so previews do not depend on a static file that
 * can 404/500 in some deployments; override with NEXT_PUBLIC_OG_IMAGE if needed.
 */
export const DEFAULT_OG_IMAGE_PATH = '/opengraph-image'

/** Bump when the default OG asset or path changes so social caches refresh. */
export const OG_IMAGE_CACHE_VERSION = '3'

/** Canonical site origin for metadata, OG URLs, and canonical links (no trailing slash). */
export function getSiteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
}

/** Path for the site-wide default og:image (NEXT_PUBLIC_OG_IMAGE overrides). */
export function getOgImagePath(): string {
  const override = (process.env.NEXT_PUBLIC_OG_IMAGE || '').trim()
  return override || DEFAULT_OG_IMAGE_PATH
}

/**
 * Absolute HTTPS URL for the default og:image / twitter:image (used by root layout and static pages).
 * This is the single server-side definition crawlers ultimately read via `<meta property="og:image" …>`.
 */
export function getDefaultOgImageAbsoluteUrl(): string {
  const base = getSiteBaseUrl()
  const path = getOgImagePath()
  const normalized = path.startsWith('/') ? path : `/${path}`
  const sep = normalized.includes('?') ? '&' : '?'
  return `${base}${normalized}${sep}v=${OG_IMAGE_CACHE_VERSION}`
}
