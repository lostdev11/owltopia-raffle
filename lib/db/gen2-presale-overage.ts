import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type Gen2PresaleOverageRow = {
  wallet: string
  allowed_mints: number
  used_mints: number
  note: string | null
}

export async function getPresaleOverageAllocation(wallet: string): Promise<Gen2PresaleOverageRow | null> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return null

  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('gen2_presale_overage_allocations').select('*').eq('wallet', w).maybeSingle()
  if (error) {
    if (error.message.includes('gen2_presale_overage_allocations')) {
      return null
    }
    throw new Error(error.message)
  }
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    wallet: String(r.wallet),
    allowed_mints: Number(r.allowed_mints ?? 0),
    used_mints: Number(r.used_mints ?? 0),
    note: r.note != null ? String(r.note) : null,
  }
}

export type BulkOverageUpsertRow = {
  wallet: string
  allowed_mints: number
  note?: string | null
}

export type BulkOverageUpsertResult = {
  upserted: number
  failed: Array<{ wallet: string; error: string }>
}

export async function bulkUpsertPresaleOverageAllocations(
  rows: BulkOverageUpsertRow[]
): Promise<BulkOverageUpsertResult> {
  const admin = getSupabaseAdmin()
  let upserted = 0
  const failed: BulkOverageUpsertResult['failed'] = []

  for (const row of rows) {
    const wallet = normalizeSolanaWalletAddress(row.wallet)
    if (!wallet) {
      failed.push({ wallet: row.wallet, error: 'Invalid wallet' })
      continue
    }
    const allowed = Math.max(0, Math.floor(row.allowed_mints))

    const { data: existing } = await admin
      .from('gen2_presale_overage_allocations')
      .select('used_mints')
      .eq('wallet', wallet)
      .maybeSingle()

    if (existing) {
      const used = Number((existing as { used_mints?: number }).used_mints ?? 0)
      if (used > allowed) {
        failed.push({ wallet, error: `used_mints (${used}) exceeds new allowed (${allowed})` })
        continue
      }
    }

    const { error } = await admin.from('gen2_presale_overage_allocations').upsert(
      {
        wallet,
        allowed_mints: allowed,
        note: row.note?.trim().slice(0, 200) || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wallet' }
    )

    if (error) {
      if (error.message.includes('gen2_presale_overage_allocations')) {
        failed.push({ wallet, error: 'Table missing — apply migration 128' })
      } else {
        failed.push({ wallet, error: error.message })
      }
      continue
    }
    upserted++
  }

  return { upserted, failed }
}

export async function sumPresaleOverageAllowed(): Promise<number> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('gen2_presale_overage_allocations').select('allowed_mints')
  if (error) {
    if (error.message.includes('gen2_presale_overage_allocations')) return 0
    throw new Error(error.message)
  }
  return (data ?? []).reduce((s, r) => s + Number((r as { allowed_mints?: number }).allowed_mints ?? 0), 0)
}
