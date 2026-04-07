import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'

const DISPLAY_NAME_MAX_LENGTH = 32

function defaultDisplayNameFromWallet(walletAddress: string): string {
  const w = walletAddress.trim()
  if (w.length <= DISPLAY_NAME_MAX_LENGTH) return w
  return `${w.slice(0, 4)}…${w.slice(-4)}`
}

export type WalletDiscordDashboard = {
  linked: boolean
  username: string | null
}

export type WalletProfileDashboard = {
  displayName: string | null
  discord: WalletDiscordDashboard
}
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
  const now = new Date().toISOString()

  const { data: existing, error: selErr } = await admin
    .from('wallet_profiles')
    .select('wallet_address')
    .eq('wallet_address', wallet)
    .maybeSingle()

  if (selErr) {
    console.error('Error reading wallet profile:', selErr.message)
    return { ok: false, error: selErr.message }
  }

  if (existing?.wallet_address) {
    const { error } = await admin
      .from('wallet_profiles')
      .update({ display_name: name, updated_at: now })
      .eq('wallet_address', wallet)
    if (error) {
      console.error('Error updating wallet profile:', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  }

  const { error } = await admin.from('wallet_profiles').insert({
    wallet_address: wallet,
    display_name: name,
    updated_at: now,
  })
  if (error) {
    console.error('Error inserting wallet profile:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * Signed-in user dashboard: display name + Discord link status (one row read).
 */
export async function getWalletProfileForDashboard(wallet: string): Promise<WalletProfileDashboard> {
  const w = wallet.trim()
  if (!w) {
    return { displayName: null, discord: { linked: false, username: null } }
  }

  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('wallet_profiles')
    .select('display_name, discord_user_id, discord_username')
    .eq('wallet_address', w)
    .maybeSingle()

  if (error || !data) {
    return { displayName: null, discord: { linked: false, username: null } }
  }

  const displayName =
    data.display_name != null && String(data.display_name).trim()
      ? String(data.display_name).trim().slice(0, DISPLAY_NAME_MAX_LENGTH)
      : null

  const did = data.discord_user_id != null ? String(data.discord_user_id).trim() : ''
  const un = data.discord_username != null ? String(data.discord_username).trim() : ''
  const discord: WalletDiscordDashboard = {
    linked: !!did,
    username: un || null,
  }

  return { displayName, discord }
}

/**
 * Winner webhooks: Discord user ids (snowflakes) for mentions.
 */
export async function getDiscordUserIdsByWallets(wallets: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(wallets.map((x) => x.trim()).filter(Boolean))]
  if (unique.length === 0) return {}

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('wallet_profiles')
    .select('wallet_address, discord_user_id')
    .in('wallet_address', unique)
    .not('discord_user_id', 'is', null)

  if (error) {
    console.error('getDiscordUserIdsByWallets:', error.message)
    return {}
  }

  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    const wa = row?.wallet_address != null ? String(row.wallet_address).trim() : ''
    const did = row?.discord_user_id != null ? String(row.discord_user_id).trim() : ''
    if (wa && did) map[wa] = did
  }
  return map
}

export async function linkDiscordToWallet(
  walletAddress: string,
  discordUserId: string,
  discordUsername: string
): Promise<{ ok: true } | { ok: false; code: 'taken' | 'db'; message: string }> {
  const wallet = walletAddress.trim()
  const did = discordUserId.trim()
  const dname = discordUsername.trim().slice(0, 64)
  if (!wallet || !did) return { ok: false, code: 'db', message: 'Invalid link data' }

  const admin = getSupabaseAdmin()

  const { data: taken, error: takenErr } = await admin
    .from('wallet_profiles')
    .select('wallet_address')
    .eq('discord_user_id', did)
    .neq('wallet_address', wallet)
    .maybeSingle()

  if (takenErr) {
    console.error('linkDiscordToWallet taken check:', takenErr.message)
    return { ok: false, code: 'db', message: takenErr.message }
  }
  if (taken?.wallet_address) {
    return {
      ok: false,
      code: 'taken',
      message: 'This Discord account is already linked to a different wallet.',
    }
  }

  const { data: existing } = await admin
    .from('wallet_profiles')
    .select('display_name')
    .eq('wallet_address', wallet)
    .maybeSingle()

  const displayName =
    existing?.display_name != null && String(existing.display_name).trim()
      ? String(existing.display_name).trim().slice(0, DISPLAY_NAME_MAX_LENGTH)
      : defaultDisplayNameFromWallet(wallet)

  const now = new Date().toISOString()
  const { error } = await admin.from('wallet_profiles').upsert(
    {
      wallet_address: wallet,
      display_name: displayName,
      discord_user_id: did,
      discord_username: dname || null,
      discord_linked_at: now,
      updated_at: now,
    },
    { onConflict: 'wallet_address' }
  )

  if (error) {
    console.error('linkDiscordToWallet upsert:', error.message)
    return { ok: false, code: 'db', message: error.message }
  }
  return { ok: true }
}

export async function unlinkDiscordFromWallet(walletAddress: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const wallet = walletAddress.trim()
  if (!wallet) return { ok: false, error: 'Wallet required' }

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('wallet_profiles')
    .update({
      discord_user_id: null,
      discord_username: null,
      discord_linked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('wallet_address', wallet)

  if (error) {
    console.error('unlinkDiscordFromWallet:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
