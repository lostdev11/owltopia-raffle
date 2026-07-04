import type { Raffle } from '@/lib/types'

export type PartnerLogo = {
  src: string
  alt: string
}

/** Canonical assets under `/public/partners/` — replace files on disk to update artwork. */
const LOGO_ASSETS = {
  sharkyfi: { src: '/partners/sharkyfi-logo.png', alt: 'SharkyFi partner logo' },
  jesterOwl: { src: '/partners/jester-owl-logo.png', alt: 'Jester Owl partner logo' },
  smile: { src: '/partners/smile-logo.png', alt: 'Smile QR partner logo' },
  fuddy: { src: '/partners/fuddy-logo.png', alt: 'Fuddy partner logo' },
  gearhead: { src: '/partners/gearhead-logo.png', alt: 'Gearhead Coin partner logo' },
  panda: { src: '/partners/panda-partner.png', alt: 'Roaring Panda partner logo' },
  shonenSol: { src: '/partners/shonen-sol.png', alt: 'Shonen Sol partner logo' },
  communityMark: { src: '/partners/partner-community-mark.png', alt: 'Partner community logo' },
  uglyApeSquad: { src: '/partners/ugly-ape-squad-logo.png', alt: 'Ugly Ape Squad partner logo' },
  uglyMutantApeSquad: {
    src: '/partners/ugly-mutant-ape-squad-logo.png',
    alt: 'Ugly Mutant Ape Squad partner logo',
  },
  shaolinSaga: { src: '/partners/shaolin-saga-logo.png', alt: 'Shaolin Saga partner logo' },
} as const satisfies Record<string, PartnerLogo>

/** Fixed Partner Spotlight marquee order (smooth scroll strip). */
export const PARTNER_SPOTLIGHT_BRANDS: PartnerLogo[] = [
  LOGO_ASSETS.sharkyfi,
  LOGO_ASSETS.jesterOwl,
  LOGO_ASSETS.smile,
  LOGO_ASSETS.fuddy,
  LOGO_ASSETS.gearhead,
  LOGO_ASSETS.panda,
  LOGO_ASSETS.shonenSol,
  LOGO_ASSETS.communityMark,
  LOGO_ASSETS.uglyApeSquad,
  LOGO_ASSETS.uglyMutantApeSquad,
  LOGO_ASSETS.shaolinSaga,
]

export const PARTNER_LOGOS: PartnerLogo[] = Object.values(LOGO_ASSETS)

/**
 * Explicit creator wallet (base58) → spotlight logo. Use when display-name rules are ambiguous
 * or `creator_partner_display_name` is unset.
 */
export const PARTNER_SPOTLIGHT_LOGO_BY_WALLET: Record<string, PartnerLogo> = {}

/** Order matters: first match wins (prefer more specific patterns). */
const SPOTLIGHT_LABEL_MATCHES: { pattern: RegExp; logo: PartnerLogo }[] = [
  { pattern: /sharky|sharkyfi/i, logo: LOGO_ASSETS.sharkyfi },
  { pattern: /\bshonen\b|shōnen|shonen\s*sol/i, logo: LOGO_ASSETS.shonenSol },
  { pattern: /gearhead/i, logo: LOGO_ASSETS.gearhead },
  { pattern: /jester/i, logo: LOGO_ASSETS.jesterOwl },
  { pattern: /roaring\s*panda|panda\s*partner|^panda$/i, logo: LOGO_ASSETS.panda },
  { pattern: /fuddy/i, logo: LOGO_ASSETS.fuddy },
  { pattern: /shaolin\s*saga|\bshaolin\b/i, logo: LOGO_ASSETS.shaolinSaga },
  { pattern: /ugly\s*mutant\s*ape|mutant\s*ape\s*squad/i, logo: LOGO_ASSETS.uglyMutantApeSquad },
  { pattern: /ugly\s*ape\s*squad|\buas\b/i, logo: LOGO_ASSETS.uglyApeSquad },
  /** Avoid matching arbitrary words containing "mile" / weak substrings; Smile QR branding */
  { pattern: /\bsmile\b|smile\s*qr/i, logo: LOGO_ASSETS.smile },
]

function matchPartnerLabelToLogo(label: string | null | undefined): PartnerLogo | null {
  const s = (label ?? '').trim()
  if (!s) return null
  for (const { pattern, logo } of SPOTLIGHT_LABEL_MATCHES) {
    if (pattern.test(s)) return logo
  }
  return null
}

/**
 * Logo to show in the Partner Spotlight strip (not the raffle prize/NFT image).
 * Uses wallet overrides, then admin `display_label` (brand name), then profile display name — patterns
 * often match the table label even when the wallet profile is a generic handle.
 */
export function getPartnerSpotlightLogo(raffle: Raffle): PartnerLogo | null {
  const wallet = (raffle.creator_wallet ?? '').trim()
  if (wallet && PARTNER_SPOTLIGHT_LOGO_BY_WALLET[wallet]) {
    return PARTNER_SPOTLIGHT_LOGO_BY_WALLET[wallet]
  }

  const fromTable = matchPartnerLabelToLogo(raffle.creator_partner_table_label)
  if (fromTable) return fromTable
  return matchPartnerLabelToLogo(raffle.creator_partner_display_name)
}

const PLACEHOLDER_SRC = '/partners/partner-slot-placeholder.svg'

/** Try alternate extensions so uploads match whether the file is PNG, GIF, or WebP. */
export function partnerSpotlightImageCandidates(primarySrc: string): string[] {
  const slot = PLACEHOLDER_SRC
  // Raster uploads win over bundled SVG when present (checked first).
  if (primarySrc.includes('shonen-sol')) {
    return [
      '/partners/shonen-sol.png',
      '/partners/shonen-sol.gif',
      '/partners/shonen-sol.webp',
      '/partners/shonen-sol.svg',
      slot,
    ]
  }
  if (primarySrc.includes('partner-community-mark')) {
    return [
      '/partners/partner-community-mark.png',
      '/partners/partner-community-mark.jpg',
      '/partners/partner-community-mark.jpeg',
      '/partners/partner-community-mark.webp',
      '/partners/partner-community-mark.svg',
      slot,
    ]
  }
  return [primarySrc, slot]
}

