import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'

export type GenOwlRevShareEligibleNestBucket = 'standard' | 'one-of-one'

export type GenOwlRevShareEligibleNestRow = {
  period_month: string
  position_id: string
  wallet_address: string
  asset_identifier: string | null
  group_key: GenOwlStakingGroupKey
  bucket: GenOwlRevShareEligibleNestBucket
  created_at: string
}

export type GenOwlRevShareEligibleNestInsert = {
  period_month: string
  position_id: string
  wallet_address: string
  asset_identifier: string | null
  group_key: GenOwlStakingGroupKey
  bucket: GenOwlRevShareEligibleNestBucket
}

function mapRow(data: Record<string, unknown>): GenOwlRevShareEligibleNestRow {
  return {
    period_month: String(data.period_month),
    position_id: String(data.position_id),
    wallet_address: String(data.wallet_address),
    asset_identifier: data.asset_identifier != null ? String(data.asset_identifier) : null,
    group_key: data.group_key as GenOwlStakingGroupKey,
    bucket: data.bucket === 'one-of-one' ? 'one-of-one' : 'standard',
    created_at: String(data.created_at),
  }
}

/** Delete finalize snapshot for a period (admin recompute). */
export async function deleteGenOwlRevShareEligibleNestsForPeriod(periodMonth: string): Promise<void> {
  const db = getSupabaseAdmin()
  const { error } = await db
    .from('gen_owl_rev_share_eligible_nests')
    .delete()
    .eq('period_month', periodMonth.trim())
  if (error) {
    console.error('[gen-owl-rev-share-eligible-nests] delete:', error.message)
    throw new Error(error.message)
  }
}

/**
 * Replace the eligible-nest snapshot for a period (delete + insert).
 * Call only from finalize / force-refinalize.
 */
export async function replaceGenOwlRevShareEligibleNestsForPeriod(
  periodMonth: string,
  rows: GenOwlRevShareEligibleNestInsert[]
): Promise<void> {
  const month = periodMonth.trim()
  await deleteGenOwlRevShareEligibleNestsForPeriod(month)
  if (rows.length === 0) return

  const db = getSupabaseAdmin()
  const payload = rows.map((row) => ({
    period_month: month,
    position_id: row.position_id.trim(),
    wallet_address: row.wallet_address.trim(),
    asset_identifier: row.asset_identifier?.trim() || null,
    group_key: row.group_key,
    bucket: row.bucket,
  }))

  // PostgREST insert chunks — keep under payload limits for large months.
  const CHUNK = 500
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload.slice(i, i + CHUNK)
    const { error } = await db.from('gen_owl_rev_share_eligible_nests').insert(chunk)
    if (error) {
      console.error('[gen-owl-rev-share-eligible-nests] insert:', error.message)
      throw new Error(error.message)
    }
  }
}

export async function getGenOwlRevShareEligibleNestBucket(params: {
  periodMonth: string
  positionId: string
}): Promise<GenOwlRevShareEligibleNestBucket | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('gen_owl_rev_share_eligible_nests')
    .select('bucket')
    .eq('period_month', params.periodMonth.trim())
    .eq('position_id', params.positionId.trim())
    .maybeSingle()
  if (error || !data) return null
  return data.bucket === 'one-of-one' ? 'one-of-one' : 'standard'
}

export async function listGenOwlRevShareEligibleNestBucketsForPeriod(
  periodMonth: string
): Promise<Map<string, GenOwlRevShareEligibleNestBucket>> {
  const db = getSupabaseAdmin()
  const out = new Map<string, GenOwlRevShareEligibleNestBucket>()
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from('gen_owl_rev_share_eligible_nests')
      .select('position_id, bucket')
      .eq('period_month', periodMonth.trim())
      .order('position_id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) {
      console.error('[gen-owl-rev-share-eligible-nests] list:', error.message)
      return out
    }
    const page = data ?? []
    for (const row of page) {
      out.set(
        String(row.position_id),
        row.bucket === 'one-of-one' ? 'one-of-one' : 'standard'
      )
    }
    if (page.length < PAGE) break
  }
  return out
}

export async function countGenOwlRevShareEligibleNestsForPeriod(periodMonth: string): Promise<number> {
  const db = getSupabaseAdmin()
  const { count, error } = await db
    .from('gen_owl_rev_share_eligible_nests')
    .select('position_id', { count: 'exact', head: true })
    .eq('period_month', periodMonth.trim())
  if (error) return 0
  return count ?? 0
}
