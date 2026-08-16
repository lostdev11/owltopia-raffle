import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type LaunchWlWalletRow = {
  launch_id: string
  wallet: string
  allowed_mints: number
  used_mints: number
  note: string | null
  created_by_wallet: string | null
  created_at: string
  updated_at: string
}

function mapRow(row: Record<string, unknown>): LaunchWlWalletRow {
  return {
    launch_id: String(row.launch_id),
    wallet: String(row.wallet),
    allowed_mints: Number(row.allowed_mints ?? 0),
    used_mints: Number(row.used_mints ?? 0),
    note: row.note != null ? String(row.note) : null,
    created_by_wallet: row.created_by_wallet != null ? String(row.created_by_wallet) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

export async function listLaunchWlWallets(launchId: string): Promise<LaunchWlWalletRow[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_launch_wl_wallets')
    .select('*')
    .eq('launch_id', launchId)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) {
    console.error('listLaunchWlWallets:', error.message)
    return []
  }
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export async function getLaunchWlWallet(
  launchId: string,
  wallet: string
): Promise<LaunchWlWalletRow | null> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return null
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_launch_wl_wallets')
    .select('*')
    .eq('launch_id', launchId)
    .eq('wallet', w)
    .maybeSingle()
  if (error || !data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function bulkUpsertLaunchWlWallets(input: {
  launchId: string
  wallets: Array<{ wallet: string; allowed_mints?: number; note?: string | null }>
  createdByWallet: string
}): Promise<{ upserted: number; failed: Array<{ wallet: string; error: string }> }> {
  const db = getSupabaseAdmin()
  let upserted = 0
  const failed: Array<{ wallet: string; error: string }> = []
  const now = new Date().toISOString()

  for (const row of input.wallets) {
    const wallet = normalizeSolanaWalletAddress(row.wallet)
    if (!wallet) {
      failed.push({ wallet: row.wallet, error: 'Invalid wallet' })
      continue
    }
    const allowed = Math.max(1, Math.floor(Number(row.allowed_mints ?? 1) || 1))
    const { data: existing } = await db
      .from('owl_center_launch_wl_wallets')
      .select('used_mints')
      .eq('launch_id', input.launchId)
      .eq('wallet', wallet)
      .maybeSingle()
    const used = Number((existing as { used_mints?: number } | null)?.used_mints ?? 0)
    if (used > allowed) {
      failed.push({ wallet, error: `used_mints (${used}) exceeds new allowed (${allowed})` })
      continue
    }

    const { error } = await db.from('owl_center_launch_wl_wallets').upsert(
      {
        launch_id: input.launchId,
        wallet,
        allowed_mints: allowed,
        used_mints: used,
        note: row.note?.trim().slice(0, 200) || null,
        created_by_wallet: input.createdByWallet,
        updated_at: now,
      },
      { onConflict: 'launch_id,wallet' }
    )
    if (error) {
      failed.push({ wallet, error: error.message })
      continue
    }
    upserted++
  }

  return { upserted, failed }
}

export async function removeLaunchWlWallet(
  launchId: string,
  wallet: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return { ok: false, error: 'Invalid wallet address' }
  const db = getSupabaseAdmin()
  const { error } = await db
    .from('owl_center_launch_wl_wallets')
    .delete()
    .eq('launch_id', launchId)
    .eq('wallet', w)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Increment used_mints for a WL mint (capped by allowed_mints). */
export async function consumeLaunchWlMints(
  launchId: string,
  wallet: string,
  quantity: number
): Promise<{ ok: true; used_mints: number } | { ok: false; error: string }> {
  const w = normalizeSolanaWalletAddress(wallet)
  const qty = Math.floor(quantity)
  if (!w || qty < 1) return { ok: false, error: 'Invalid wallet or quantity' }

  const row = await getLaunchWlWallet(launchId, w)
  if (!row) return { ok: false, error: 'Wallet is not on this collection whitelist' }
  const nextUsed = row.used_mints + qty
  if (nextUsed > row.allowed_mints) {
    return { ok: false, error: 'Whitelist mint allocation exhausted' }
  }

  const db = getSupabaseAdmin()
  const { error } = await db
    .from('owl_center_launch_wl_wallets')
    .update({ used_mints: nextUsed, updated_at: new Date().toISOString() })
    .eq('launch_id', launchId)
    .eq('wallet', w)
    .eq('used_mints', row.used_mints)

  if (error) return { ok: false, error: error.message }
  return { ok: true, used_mints: nextUsed }
}

export function parseWlWalletText(raw: string): string[] {
  const parts = raw
    .split(/[\s,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const n = normalizeSolanaWalletAddress(p)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}
