/**
 * Mint console timezone preference: UTC (default) or browser local.
 * Shared by formatMintDate / LocalMintTime / MintTimeZoneToggle.
 */

export type MintTimeZoneMode = 'utc' | 'local'

export const MINT_TIME_ZONE_STORAGE_KEY = 'owl_center_mint_tz'

export const MINT_TIME_ZONE_CHANGE_EVENT = 'owl-center-mint-tz-change'

export function parseMintTimeZoneMode(raw: unknown): MintTimeZoneMode {
  return raw === 'local' ? 'local' : 'utc'
}

/** Read preference (browser only). Defaults to UTC. */
export function readMintTimeZoneMode(): MintTimeZoneMode {
  if (typeof window === 'undefined') return 'utc'
  try {
    return parseMintTimeZoneMode(window.localStorage.getItem(MINT_TIME_ZONE_STORAGE_KEY))
  } catch {
    return 'utc'
  }
}

export function writeMintTimeZoneMode(mode: MintTimeZoneMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MINT_TIME_ZONE_STORAGE_KEY, mode)
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new CustomEvent(MINT_TIME_ZONE_CHANGE_EVENT, { detail: mode }))
}

export function mintTimeZoneOptions(mode: MintTimeZoneMode): Intl.DateTimeFormatOptions {
  return mode === 'utc' ? { timeZone: 'UTC' } : {}
}
