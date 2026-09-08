/**
 * OwlSwap collection allowlist.
 *
 * - Admin preview: empty allowlist → allow any mint UNLESS OwlSwap is public.
 * - Public mode: empty allowlist is rejected unless OWL_SWAP_ALLOW_ANY_MINT=true.
 * - When collections are configured, client-supplied collection must match (Phase 1).
 *   Do not treat metadata as ownership proof.
 */

import { isOwlSwapPublic } from '@/lib/owl-swap/access'

function parseAllowedCollections(): string[] {
  const raw =
    typeof process !== 'undefined' ? process.env.OWL_SWAP_ALLOWED_COLLECTIONS?.trim() : undefined
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function allowAnyMintBreakGlass(): boolean {
  const raw = process.env.OWL_SWAP_ALLOW_ANY_MINT?.trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'yes'
}

export function getOwlSwapAllowedCollections(): string[] {
  return parseAllowedCollections()
}

/**
 * Verify a mint/collection for an offer asset.
 */
export function verifyOwlSwapMintForAllowlist(params: {
  mint: string
  collection?: string | null
}): { verified: boolean; reason?: string } {
  const allowed = parseAllowedCollections()
  if (allowed.length === 0) {
    if (isOwlSwapPublic() && !allowAnyMintBreakGlass()) {
      return {
        verified: false,
        reason:
          'OwlSwap is public but OWL_SWAP_ALLOWED_COLLECTIONS is empty. Set collections or OWL_SWAP_ALLOW_ANY_MINT=true.',
      }
    }
    return { verified: true }
  }
  const collection = params.collection?.trim() ?? ''
  if (!collection) {
    return { verified: false, reason: 'Collection required for allowlisted OwlSwap.' }
  }
  if (allowed.includes(collection)) {
    return { verified: true }
  }
  return { verified: false, reason: 'Collection is not on the OwlSwap allowlist.' }
}
