/**
 * OwlSwap collection allowlist (Phase 1 stub).
 *
 * Admin preview: empty allowlist → allow any mint (verified:true).
 * When `OWL_SWAP_ALLOWED_COLLECTIONS` is set (comma-separated), only those collections pass.
 */

function parseAllowedCollections(): string[] {
  const raw =
    typeof process !== 'undefined' ? process.env.OWL_SWAP_ALLOWED_COLLECTIONS?.trim() : undefined
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function getOwlSwapAllowedCollections(): string[] {
  return parseAllowedCollections()
}

/**
 * Verify a mint/collection for an offer asset.
 * Returns `{ verified: true }` for admin testing when no allowlist is configured.
 */
export function verifyOwlSwapMintForAllowlist(params: {
  mint: string
  collection?: string | null
}): { verified: boolean; reason?: string } {
  const allowed = parseAllowedCollections()
  if (allowed.length === 0) {
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
