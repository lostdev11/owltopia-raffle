import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'

const DISPLAY_NAME_MAX_LENGTH = 32
const DISPLAY_NAME_TRIM_REGEX = /^\s*(.{1,32})\s*$/ // trim and cap 32 chars

export function sanitizeDisplayName(input: string): string {
  const trimmed = input.trim().slice(0, DISPLAY_NAME_MAX_LENGTH)
  return trimmed || ''
}

/**
 * Fetch display names for a list of wallet addresses. Returns a map wallet -> display_name (only for wallets that have a profile).
 */
export async function getDisplayNamesByWallets(
  wallets: string[]
): Promise<Record<string, string>> {
  const unique = [...new Set(wallets)].filter(Boolean)
  if (unique.length === 0) return {}

  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('wallet_profiles')
    .select('wallet_address, display_name')
    .in('wallet_address', unique)

  if (error) {
    console.error('Error fetching wallet profiles:', error.message)
    return {}
  }

  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    if (row?.wallet_address && row?.display_name) {
      map[row.wallet_address] = row.display_name
    }
  }
  return map
}

/**
 * Upsert display name for a wallet. Caller must use service role and have verified the wallet (e.g. via session).
 */
export async function upsertWalletProfile(
  walletAddress: string,
  displayName: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const wallet = walletAddress.trim()
  const name = sanitizeDisplayName(displayName)
  if (!wallet) return { ok: false, error: 'Wallet address required' }
  if (!name) return { ok: false, error: 'Display name cannot be empty' }

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('wallet_profiles')
    .upsert(
      {
        wallet_address: wallet,
        display_name: name,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address' }
    )

  if (error) {
    console.error('Error upserting wallet profile:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
