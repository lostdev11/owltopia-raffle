/**
 * Site/platform branding. When NEXT_PUBLIC_PLATFORM_NAME is set, it is used
 * everywhere the platform name appears (titles, metadata, footer, wallet app identity, etc.).
 */
const raw = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_PLATFORM_NAME?.trim()
export const PLATFORM_NAME = raw || 'Owl Raffle'

/** Default OG/twitter alt and tagline suffix. */
export const OG_TAGLINE = 'Trusted raffles with full transparency. Every entry verified on-chain.'
export const OG_ALT = `${PLATFORM_NAME} - ${OG_TAGLINE}`
