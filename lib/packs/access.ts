/**
 * Owl Packs rollout gate — admin preview first (same idea as OwlSend).
 *
 * Default: admin-only.
 * Go live: set `PACKS_PUBLIC=true` and `NEXT_PUBLIC_PACKS_PUBLIC=true`.
 */

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return fallback
}

/** When false (default), only site admins may use Owl Packs. */
export function isPacksPublic(): boolean {
  if (typeof process === 'undefined') return false
  return readBoolean(
    process.env.PACKS_PUBLIC ?? process.env.NEXT_PUBLIC_PACKS_PUBLIC,
    false
  )
}

/** Client-safe public flag (NEXT_PUBLIC only). */
export function isPacksPublicClient(): boolean {
  if (typeof process === 'undefined') return false
  return readBoolean(process.env.NEXT_PUBLIC_PACKS_PUBLIC, false)
}

export function canAccessPacks(params: {
  isAdmin: boolean
  publicOverride?: boolean
}): boolean {
  const isPublic =
    typeof params.publicOverride === 'boolean' ? params.publicOverride : isPacksPublic()
  return isPublic || params.isAdmin
}
