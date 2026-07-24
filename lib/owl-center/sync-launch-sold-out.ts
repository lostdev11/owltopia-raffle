import { getSupabaseAdmin } from '@/lib/supabase-admin'

/**
 * Mark launch sold out when DB supply is exhausted (e.g. after orphan backfill),
 * or when `force` is set because the Candy Machine is empty on-chain while the
 * DB ledger still shows leftovers.
 *
 * Kept in a lightweight module (no mint-tx / marketplace imports) so Gen2 eligibility
 * and wallet reconcile can call it without pulling `server-only` into client graphs.
 */
export async function syncLaunchSoldOutPhaseIfExhausted(
  launchId: string,
  opts?: { force?: boolean; reason?: string }
): Promise<boolean> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_launches')
    .select('id,minted_count,total_supply,active_phase,status')
    .eq('id', launchId)
    .maybeSingle()
  if (error || !data) return false

  const row = data as {
    minted_count: number
    total_supply: number
    active_phase: string
    status: string
  }
  if (!opts?.force && row.minted_count < row.total_supply) return false
  if (row.active_phase === 'TRADING_ACTIVE') return false
  if (row.active_phase === 'SOLD_OUT' && row.status === 'SOLD_OUT') return false

  const { error: updErr } = await db
    .from('owl_center_launches')
    .update({
      active_phase: 'SOLD_OUT',
      status: 'SOLD_OUT',
      updated_at: new Date().toISOString(),
    })
    .eq('id', launchId)

  if (updErr) return false

  const detail =
    opts?.reason?.trim() ||
    (opts?.force
      ? `on-chain Candy Machine empty (DB ${row.minted_count}/${row.total_supply})`
      : `supply exhausted (${row.minted_count}/${row.total_supply})`)

  await db.from('owl_center_activity_logs').insert({
    launch_id: launchId,
    message: `SELL_OUT ${detail} — phase synced`,
    event_type: 'system',
  })

  return true
}
