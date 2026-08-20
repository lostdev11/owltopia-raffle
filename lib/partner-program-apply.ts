export const PARTNER_APPLY_TIERS = ['$0_partner', 'partner_pro', 'white_label'] as const
export type PartnerApplyTier = (typeof PARTNER_APPLY_TIERS)[number]

/** Shareable Partner Pro apply link (preselects the form). */
export const PARTNER_PRO_APPLY_HREF = '/partner-program?tier=pro#partner-apply'
/** Shareable white-label apply link (preselects the form). */
export const WHITE_LABEL_APPLY_HREF = '/partner-program?tier=wl#partner-apply'

export function isPaidPartnerApplyTier(tier: string): boolean {
  return tier === 'partner_pro' || tier === 'white_label'
}

export function parsePartnerApplyTier(raw: string | null | undefined): PartnerApplyTier | null {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (v === 'partner_pro' || v === 'pro') return 'partner_pro'
  if (v === 'white_label' || v === 'white-label' || v === 'wl') return 'white_label'
  if (v === '$0_partner' || v === '0' || v === 'free') return '$0_partner'
  return null
}

/** HTTPS project site or Discord invite. Allows pasting discord.gg without a scheme. */
export function normalizePartnerCommunityHttpsUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'https:') return null
    if (u.href.length > 500) return null
    return u.href
  } catch {
    return null
  }
}
