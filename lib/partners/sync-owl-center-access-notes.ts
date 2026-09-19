/** Pure helpers for Partner Program ↔ Owl Center sync notes (no DB imports). */

export const PARTNER_PRO_OWL_CENTER_SYNC_NOTE = 'Synced from Partner Program allowlist'

export function buildPartnerProOwlCenterSyncNotes(detail?: string | null): string {
  const d = typeof detail === 'string' ? detail.trim() : ''
  return d ? `${PARTNER_PRO_OWL_CENTER_SYNC_NOTE} (${d})` : PARTNER_PRO_OWL_CENTER_SYNC_NOTE
}

/** Only overwrite empty notes or prior Partner Program sync notes. */
export function shouldReplacePartnerProOwlCenterNotes(
  existingNotes: string | null | undefined
): boolean {
  const n = (existingNotes ?? '').trim()
  if (!n) return true
  return n.startsWith(PARTNER_PRO_OWL_CENTER_SYNC_NOTE)
}
