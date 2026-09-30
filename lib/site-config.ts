/**
 * Site/platform branding. When NEXT_PUBLIC_PLATFORM_NAME is set, it is used
 * everywhere the platform name appears (titles, metadata, footer, wallet app identity, etc.).
 */
const raw = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_PLATFORM_NAME?.trim()
export const PLATFORM_NAME = raw || 'Owltopia'

/** Owltopia Discord invite (same link as Footer). */
export const COMMUNITY_DISCORD_INVITE_URL = 'https://discord.gg/nRD2wyg2vq'

/** Placeholder until dev dad confirms the live mailbox. */
export const SECURITY_CONTACT_EMAIL = 'security@owltopia.xyz'

/** Primary meta description for crawlers, wallets, and link previews. */
export const SITE_META_DESCRIPTION =
  'Owltopia is a community Solana NFT platform for transparent raffles, Owl Packs, the Owl Center launchpad, and OWL nesting (staking). Ticket payments go to published escrow addresses; you approve each transfer in your wallet.'

/** Default OG/twitter alt and tagline suffix. */
export const OG_TAGLINE = 'Community Solana raffles, packs, launchpad, and nesting — transparent escrow flows.'
export const OG_ALT = `${PLATFORM_NAME} - ${OG_TAGLINE}`

/**
 * Default link-preview image path.
 * Use a static image for maximum social-crawler compatibility.
 * Override with NEXT_PUBLIC_OG_IMAGE if needed.
 */
export const DEFAULT_OG_IMAGE_PATH = '/og-image.jpg'

/** Width/height of `public/og-image.jpg` (update if the asset changes). */
export const DEFAULT_OG_IMAGE_DIMS = { width: 986, height: 647 } as const
export const DEFAULT_OG_IMAGE_TYPE = 'image/jpeg' as const

/** Bump when the default OG asset or path changes so social caches refresh. */
export const OG_IMAGE_CACHE_VERSION = '16'

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
