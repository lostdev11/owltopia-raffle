/**
 * OwlSwap rollout gate — admin preview first (same idea as OwlSend).
 *
 * Default: admin-only.
 * Go live: set `OWL_SWAP_PUBLIC=true` and `NEXT_PUBLIC_OWL_SWAP_PUBLIC=true`.
 */

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return fallback
}

/** When false (default), only site admins may use OwlSwap. */
export function isOwlSwapPublic(): boolean {
  if (typeof process === 'undefined') return false
  return readBoolean(
    process.env.OWL_SWAP_PUBLIC ?? process.env.NEXT_PUBLIC_OWL_SWAP_PUBLIC,
    false
  )
}

/** Client-safe public flag (NEXT_PUBLIC only). */
export function isOwlSwapPublicClient(): boolean {
  if (typeof process === 'undefined') return false
  return readBoolean(process.env.NEXT_PUBLIC_OWL_SWAP_PUBLIC, false)
}

export function canAccessOwlSwap(params: {
  isAdmin: boolean
  publicOverride?: boolean
}): boolean {
  const isPublic =
    typeof params.publicOverride === 'boolean' ? params.publicOverride : isOwlSwapPublic()
  return isPublic || params.isAdmin
}
