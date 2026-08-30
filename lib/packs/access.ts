/**
 * Owl Packs access gate.
 *
 * Launch mode (Admin → Packs, no redeploy):
 * - `public` — everyone may use /packs + purchase APIs (when unpaused)
 * - `restricted` — Owl Vision admins + pack_test_wallets only
 *
 * Emergency kill switch: set `PACKS_PUBLIC=false` and `NEXT_PUBLIC_PACKS_PUBLIC=false`
 * then redeploy — hides Packs from everyone except admins (testers blocked too).
 *
 * Purchases remain gated by `pack_vault_config.paused` independently.
 */

import {
  getPackAccessMode,
  type PackAccessMode,
} from '@/lib/db/pack-public-settings'

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return fallback
}

/**
 * Explicit env false turns Packs off for non-admins (emergency).
 * Unset / true → defer to DB `access_mode`.
 */
export function isPacksEnvKillSwitch(): boolean {
  if (typeof process === 'undefined') return false
  const raw = process.env.PACKS_PUBLIC ?? process.env.NEXT_PUBLIC_PACKS_PUBLIC
  if (raw == null || raw.trim() === '') return false
  return readBoolean(raw, true) === false
}

/** Client-safe kill switch (NEXT_PUBLIC only). */
export function isPacksEnvKillSwitchClient(): boolean {
  if (typeof process === 'undefined') return false
  const raw = process.env.NEXT_PUBLIC_PACKS_PUBLIC
  if (raw == null || raw.trim() === '') return false
  return readBoolean(raw, true) === false
}

/**
 * True when Packs is open to everyone (DB public mode and no env kill switch).
 * Prefer this over the legacy sync env-only helper.
 */
export async function isPacksPublic(): Promise<boolean> {
  if (isPacksEnvKillSwitch()) return false
  return (await getPackAccessMode()) === 'public'
}

/**
 * Client hint: only true when NEXT_PUBLIC explicitly says public.
 * Prefer `/api/packs/access-check` or `/api/packs/public-settings` for real mode
 * (DB-backed). Defaults false so restricted mode does not flash public nav.
 */
export function isPacksPublicClient(): boolean {
  if (typeof process === 'undefined') return false
  if (isPacksEnvKillSwitchClient()) return false
  const raw = process.env.NEXT_PUBLIC_PACKS_PUBLIC
  if (raw == null || raw.trim() === '') return false
  return readBoolean(raw, false)
}

export function canAccessPacks(params: {
  isAdmin: boolean
  isTester?: boolean
  /** When known, skip re-reading public state. */
  isPublic?: boolean
}): boolean {
  if (params.isPublic === true) return true
  if (params.isAdmin) return true
  if (params.isTester) return true
  return false
}

export async function resolvePackAccess(params: {
  isAdmin: boolean
  isTester: boolean
}): Promise<{
  allowed: boolean
  isPublic: boolean
  accessMode: PackAccessMode
  killSwitch: boolean
}> {
  const killSwitch = isPacksEnvKillSwitch()
  if (killSwitch) {
    return {
      allowed: params.isAdmin,
      isPublic: false,
      accessMode: 'restricted',
      killSwitch: true,
    }
  }
  const accessMode = await getPackAccessMode()
  const isPublic = accessMode === 'public'
  const allowed = canAccessPacks({
    isAdmin: params.isAdmin,
    isTester: params.isTester,
    isPublic,
  })
  return { allowed, isPublic, accessMode, killSwitch: false }
}
