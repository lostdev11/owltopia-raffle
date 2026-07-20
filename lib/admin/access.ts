import { getAdminRole, isAdmin, type AdminRole } from '@/lib/db/admins'
import { parseAdminRole } from '@/lib/admin/roles'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

function parseAdminWalletsFromEnv(): string[] {
  const raw = process.env.ADMIN_WALLETS?.trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => normalizeSolanaWalletAddress(s.trim()))
    .filter((x): x is string => !!x)
}

/** DB admin or comma-separated `ADMIN_WALLETS` env (presale / launch operators). */
export async function isOwlVisionAdmin(wallet: string): Promise<boolean> {
  if (await isAdmin(wallet)) return true
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return false
  return parseAdminWalletsFromEnv().some((a) => a === w)
}

/**
 * DB role when present; env-listed operators get `full` for Owl Center / presale parity.
 * Junior mods are only those stored as `mod` in `admins` (not env wallets).
 */
export async function getOwlVisionAdminRole(wallet: string): Promise<AdminRole | null> {
  const dbRole = await getAdminRole(wallet)
  if (dbRole) return dbRole
  if (await isOwlVisionAdmin(wallet)) return 'full'
  return null
}

export { parseAdminRole, isFullAdminRole, isModOrAboveRole, isAnyAdminRole } from '@/lib/admin/roles'
