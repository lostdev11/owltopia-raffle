import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type WlAllocationRow = {
  wallet: string
  allowed_mints: number
  used_mints: number
  community: string | null
}

export type BulkWlUpsertRow = {
  wallet: string
  allowed_mints: number
  community?: string | null
}

export type BulkWlUpsertResult = {
  upserted: number
  failed: Array<{ wallet: string; error: string }>
}

export async function bulkUpsertWlAllocations(rows: BulkWlUpsertRow[]): Promise<BulkWlUpsertResult> {
  const admin = getSupabaseAdmin()
  let upserted = 0
  const failed: BulkWlUpsertResult['failed'] = []

  for (const row of rows) {
    const wallet = normalizeSolanaWalletAddress(row.wallet)
    if (!wallet) {
      failed.push({ wallet: row.wallet, error: 'Invalid wallet' })
      continue
    }
    const allowed = Math.max(0, Math.floor(row.allowed_mints))

    const { data: existing } = await admin
      .from('owl_center_wl_allocations')
      .select('used_mints')
      .eq('wallet', wallet)
      .maybeSingle()

    const used = Number((existing as { used_mints?: number } | null)?.used_mints ?? 0)
    if (used > allowed) {
      failed.push({
        wallet,
        error: `used_mints (${used}) exceeds new allowed (${allowed})`,
      })
      continue
    }

    const payload: Record<string, unknown> = {
      wallet,
      allowed_mints: allowed,
      updated_at: new Date().toISOString(),
    }
    if (row.community !== undefined) {
      payload.community = row.community?.trim() || null
    }

    const { error } = await admin.from('owl_center_wl_allocations').upsert(payload, { onConflict: 'wallet' })
    if (error) {
      if (error.message.includes('community') && error.message.includes('column')) {
        delete payload.community
        const { error: retry } = await admin.from('owl_center_wl_allocations').upsert(payload, { onConflict: 'wallet' })
        if (retry) {
          failed.push({ wallet, error: retry.message })
          continue
        }
      } else {
        failed.push({ wallet, error: error.message })
        continue
      }
    }
    upserted++
  }

  return { upserted, failed }
}

export async function listWlAllocations(limit: number): Promise<WlAllocationRow[]> {
  const admin = getSupabaseAdmin()
  const cap = Math.min(2000, Math.max(1, Math.floor(limit)))
  const { data, error } = await admin
    .from('owl_center_wl_allocations')
    .select('wallet,allowed_mints,used_mints,community')
    .order('wallet', { ascending: true })
    .limit(cap)

  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      wallet: String(row.wallet),
      allowed_mints: Number(row.allowed_mints ?? 0),
      used_mints: Number(row.used_mints ?? 0),
      community: row.community != null ? String(row.community) : null,
    }
  })
}
