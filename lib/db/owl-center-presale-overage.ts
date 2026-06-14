import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type LaunchPresaleOverageRow = {
  launch_id: string
  wallet: string
  allowed_mints: number
  used_mints: number
  note: string | null
}

export async function getLaunchPresaleOverageAllocation(
  launchId: string,
  wallet: string
): Promise<LaunchPresaleOverageRow | null> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return null

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_presale_overage_allocations')
    .select('*')
    .eq('launch_id', launchId)
    .eq('wallet', w)
    .maybeSingle()
  if (error) {
    if (error.message.includes('owl_center_presale_overage_allocations')) return null
    throw new Error(error.message)
  }
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    launch_id: String(r.launch_id),
    wallet: String(r.wallet),
    allowed_mints: Number(r.allowed_mints ?? 0),
    used_mints: Number(r.used_mints ?? 0),
    note: r.note != null ? String(r.note) : null,
  }
}

export type BulkLaunchOverageUpsertRow = {
  wallet: string
  allowed_mints: number
  note?: string | null
}

export type BulkLaunchOverageUpsertResult = {
  upserted: number
  failed: Array<{ wallet: string; error: string }>
}

export async function bulkUpsertLaunchPresaleOverageAllocations(
  launchId: string,
  rows: BulkLaunchOverageUpsertRow[]
): Promise<BulkLaunchOverageUpsertResult> {
  const db = getSupabaseAdmin()
  let upserted = 0
  const failed: BulkLaunchOverageUpsertResult['failed'] = []

  for (const row of rows) {
    const wallet = normalizeSolanaWalletAddress(row.wallet)
    if (!wallet) {
      failed.push({ wallet: row.wallet, error: 'Invalid wallet' })
      continue
    }
    const allowed = Math.max(0, Math.floor(row.allowed_mints))

    const { data: existing } = await db
      .from('owl_center_presale_overage_allocations')
      .select('used_mints')
      .eq('launch_id', launchId)
      .eq('wallet', wallet)
      .maybeSingle()

    if (existing) {
      const used = Number((existing as { used_mints?: number }).used_mints ?? 0)
      if (used > allowed) {
        failed.push({ wallet, error: `used_mints (${used}) exceeds new allowed (${allowed})` })
        continue
      }
    }

    const { error } = await db.from('owl_center_presale_overage_allocations').upsert(
      {
        launch_id: launchId,
        wallet,
        allowed_mints: allowed,
        note: row.note?.trim().slice(0, 200) || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'launch_id,wallet' }
    )

    if (error) {
      failed.push({ wallet, error: error.message.includes('owl_center_presale_overage_allocations') ? 'Table missing — apply migration 145' : error.message })
      continue
    }
    upserted++
  }

  return { upserted, failed }
}
