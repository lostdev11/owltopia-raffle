/**
 * OwlSend rollout gate — admin preview first (same idea as nesting admin_only perches).
 *
 * Default: admin-only.
 * Go live: set `OWL_SEND_PUBLIC=true` and `NEXT_PUBLIC_OWL_SEND_PUBLIC=true`.
 *
 * CSV airdrop import is gated separately so admins can test on production first:
 * Default: admin-only. Go live: `OWL_SEND_CSV_PUBLIC=true` + `NEXT_PUBLIC_OWL_SEND_CSV_PUBLIC=true`.
 */

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return fallback
}

/** When false (default), only site admins may use OwlSend. */
export function isOwlSendPublic(): boolean {
  if (typeof process === 'undefined') return false
  return readBoolean(
    process.env.OWL_SEND_PUBLIC ?? process.env.NEXT_PUBLIC_OWL_SEND_PUBLIC,
    false
  )
}

/** Client-safe public flag (NEXT_PUBLIC only). */
export function isOwlSendPublicClient(): boolean {
  if (typeof process === 'undefined') return false
  return readBoolean(process.env.NEXT_PUBLIC_OWL_SEND_PUBLIC, false)
}

export function canAccessOwlSend(params: {
  isAdmin: boolean
  publicOverride?: boolean
}): boolean {
  const isPublic =
    typeof params.publicOverride === 'boolean' ? params.publicOverride : isOwlSendPublic()
  return isPublic || params.isAdmin
}

/** When false (default), only site admins may use OwlSend CSV airdrop import. */
export function isOwlSendCsvPublic(): boolean {
  if (typeof process === 'undefined') return false
  return readBoolean(
    process.env.OWL_SEND_CSV_PUBLIC ?? process.env.NEXT_PUBLIC_OWL_SEND_CSV_PUBLIC,
    false
  )
}

/** Client-safe CSV public flag (NEXT_PUBLIC only). */
export function isOwlSendCsvPublicClient(): boolean {
  if (typeof process === 'undefined') return false
  return readBoolean(process.env.NEXT_PUBLIC_OWL_SEND_CSV_PUBLIC, false)
}

export function canAccessOwlSendCsv(params: {
  isAdmin: boolean
  publicOverride?: boolean
}): boolean {
  const isPublic =
    typeof params.publicOverride === 'boolean' ? params.publicOverride : isOwlSendCsvPublic()
  return isPublic || params.isAdmin
}
