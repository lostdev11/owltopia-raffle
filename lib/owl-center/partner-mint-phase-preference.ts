/**
 * Buyer-facing partner mint phase preference keys (`wl`, `public`, …).
 * Kept dependency-light so unit tests can import without DB/RPC modules.
 */

import { normalizePhaseKey } from '@/lib/owl-center/partner-allowlist-phases'

/** Client/API key for the public mint phase (schedule row key). */
export const PARTNER_MINT_PUBLIC_PHASE_KEY = 'public'

/** Candy Guard public group label — mirrored from public-simple-guard-plan (avoid heavy import). */
const PUBLIC_GUARD_GROUP_LABEL = 'pub'

/**
 * Normalize a buyer-selected phase preference (`wl`, `public`, `pub`, …).
 * Returns null when unset / empty.
 */
export function normalizePartnerMintPhasePreference(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const t = String(raw).trim()
  if (!t) return null
  const lower = t.toLowerCase()
  if (lower === PARTNER_MINT_PUBLIC_PHASE_KEY || lower === PUBLIC_GUARD_GROUP_LABEL) {
    return PARTNER_MINT_PUBLIC_PHASE_KEY
  }
  const key = normalizePhaseKey(t)
  return key || null
}
