/**
 * Owl Transfer rollout gate — admin preview first (same idea as nesting admin_only perches).
 *
 * Default: admin-only.
 * Go live: set `OWL_TRANSFER_PUBLIC=true` and `NEXT_PUBLIC_OWL_TRANSFER_PUBLIC=true`.
 */

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return fallback
}

/** When false (default), only site admins may use Owl Transfer. */
export function isOwlTransferPublic(): boolean {
  if (typeof process === 'undefined') return false
  return readBoolean(
    process.env.OWL_TRANSFER_PUBLIC ?? process.env.NEXT_PUBLIC_OWL_TRANSFER_PUBLIC,
    false
  )
}

/** Client-safe public flag (NEXT_PUBLIC only). */
export function isOwlTransferPublicClient(): boolean {
  if (typeof process === 'undefined') return false
  return readBoolean(process.env.NEXT_PUBLIC_OWL_TRANSFER_PUBLIC, false)
}

export function canAccessOwlTransfer(params: {
  isAdmin: boolean
  publicOverride?: boolean
}): boolean {
  const isPublic =
    typeof params.publicOverride === 'boolean' ? params.publicOverride : isOwlTransferPublic()
  return isPublic || params.isAdmin
}
