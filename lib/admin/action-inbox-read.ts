/** Client-only mark-as-read state for Owl Vision action inbox (per admin wallet). */

export const ADMIN_ACTION_INBOX_READ_STORAGE_KEY = 'owl-vision-action-inbox-read:v1'

export type AdminActionInboxReadMap = Record<string, string>

function storageKey(wallet: string): string {
  return `${ADMIN_ACTION_INBOX_READ_STORAGE_KEY}:${wallet.trim()}`
}

export function readAdminActionInboxReadMap(wallet: string): AdminActionInboxReadMap {
  if (typeof window === 'undefined' || !wallet.trim()) return {}
  try {
    const raw = window.localStorage.getItem(storageKey(wallet))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: AdminActionInboxReadMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeAdminActionInboxReadMap(wallet: string, map: AdminActionInboxReadMap): void {
  if (typeof window === 'undefined' || !wallet.trim()) return
  try {
    window.localStorage.setItem(storageKey(wallet), JSON.stringify(map))
  } catch {
    /* quota / private mode */
  }
}

export function isAdminActionInboxItemUnread(
  wallet: string,
  item: { id: string; fingerprint: string }
): boolean {
  const map = readAdminActionInboxReadMap(wallet)
  return map[item.id] !== item.fingerprint
}

export function markAdminActionInboxItemRead(
  wallet: string,
  item: { id: string; fingerprint: string }
): AdminActionInboxReadMap {
  const map = readAdminActionInboxReadMap(wallet)
  map[item.id] = item.fingerprint
  writeAdminActionInboxReadMap(wallet, map)
  return map
}

export function markAllAdminActionInboxItemsRead(
  wallet: string,
  items: Array<{ id: string; fingerprint: string }>
): AdminActionInboxReadMap {
  const map = readAdminActionInboxReadMap(wallet)
  for (const item of items) {
    map[item.id] = item.fingerprint
  }
  writeAdminActionInboxReadMap(wallet, map)
  return map
}
