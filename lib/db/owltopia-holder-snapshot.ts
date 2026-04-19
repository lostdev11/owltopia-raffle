/**
 * Persistent Owltopia holder checks — reduces Helius credits by reusing results for up to 7 days.
 * Writes use the service role; if Supabase is unavailable, ownsOwltopia() falls back to live DAS only.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin'

/** How long a stored snapshot is trusted before live DAS runs again (when skipCache is false). */
export const OWLTOPIA_HOLDER_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function getOwltopiaSnapshotIfFresh(walletAddress: string): Promise<boolean | null> {
  const w = walletAddress.trim()
  if (!w) return null
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null

  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('owltopia_holder_snapshots')
      .select('is_holder, checked_at')
      .eq('wallet_address', w)
      .maybeSingle()

    if (error || !data || data.checked_at == null) return null

    const checkedAt = new Date(String(data.checked_at)).getTime()
    if (!Number.isFinite(checkedAt)) return null
    if (Date.now() - checkedAt > OWLTOPIA_HOLDER_SNAPSHOT_TTL_MS) return null

    return Boolean(data.is_holder)
  } catch {
    return null
  }
}

export async function upsertOwltopiaHolderSnapshot(walletAddress: string, isHolder: boolean): Promise<void> {
  const w = walletAddress.trim()
  if (!w) return
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return

  try {
    const admin = getSupabaseAdmin()
    const { error } = await admin.from('owltopia_holder_snapshots').upsert(
      {
        wallet_address: w,
        is_holder: isHolder,
        checked_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address' }
    )
    if (error) console.warn('[owltopia_holder_snapshots] upsert:', error.message)
  } catch (e) {
    console.warn('[owltopia_holder_snapshots] upsert:', e instanceof Error ? e.message : e)
  }
}
