/**
 * Owl Packs public gate.
 *
 * Default: public landing (nav + `/packs`). Purchases stay paused until an
 * admin turns packs on in Admin → Packs.
 * Hide again: set `PACKS_PUBLIC=false` and `NEXT_PUBLIC_PACKS_PUBLIC=false`
 * (NEXT_PUBLIC_* is baked at build time — redeploy after changing it).
 */

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return fallback
}

/** When false, only site admins may use Owl Packs. Default is public. */
export function isPacksPublic(): boolean {
  if (typeof process === 'undefined') return true
  return readBoolean(
    process.env.PACKS_PUBLIC ?? process.env.NEXT_PUBLIC_PACKS_PUBLIC,
    true
  )
}

/** Client-safe public flag (NEXT_PUBLIC only). Default is public. */
export function isPacksPublicClient(): boolean {
  if (typeof process === 'undefined') return true
  return readBoolean(process.env.NEXT_PUBLIC_PACKS_PUBLIC, true)
}

export function canAccessPacks(params: {
  isAdmin: boolean
  publicOverride?: boolean
}): boolean {
  const isPublic =
    typeof params.publicOverride === 'boolean' ? params.publicOverride : isPacksPublic()
  return isPublic || params.isAdmin
}
