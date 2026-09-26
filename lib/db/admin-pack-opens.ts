import { buildPackOpensListFilterPlan } from '@/lib/admin-pack-opens/parse-query'
import {
  adminPackOpensListSelect,
  mapPackOpenToAdminDetailRow,
  mapPackOpenToAdminListRow,
  type PackOpenAdminDbRow,
} from '@/lib/admin-pack-opens/map-row'
import type { AdminPackOpenDetailRow, AdminPackOpenListRow, ListAdminPackOpensParams } from '@/lib/admin-pack-opens/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function applyFilterPlan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  params: ListAdminPackOpensParams,
  nowMs: number
) {
  const plan = buildPackOpensListFilterPlan(params, nowMs)

  if (plan.wallet) {
    if (plan.wallet.mode === 'prefix') {
      query = query.ilike('buyer_wallet', `${plan.wallet.value}%`)
    } else {
      query = query.eq('buyer_wallet', plan.wallet.value)
    }
  }

  if (plan.statuses?.length) {
    query = query.in('status', plan.statuses)
  }

  if (plan.productId) {
    query = query.eq('product_id', plan.productId)
  }

  if (plan.createdFrom) {
    query = query.gte('created_at', plan.createdFrom)
  }
  if (plan.createdTo) {
    query = query.lte('created_at', plan.createdTo)
  }

  if (plan.stuckAttention) {
    const pipeline = plan.stuckAttention.pipelineStatuses.join(',')
    const cutoff = plan.stuckAttention.cutoffIso
    query = query.or(
      `status.eq.refund_needed,status.eq.failed,and(status.in.(${pipeline}),created_at.lt.${cutoff})`
    )
  }

  return query
}

export async function listAdminPackOpens(
  params: ListAdminPackOpensParams,
  nowMs = Date.now()
): Promise<{ rows: AdminPackOpenListRow[]; total: number }> {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50))
  const offset = Math.max(0, params.offset ?? 0)

  let query = getSupabaseAdmin()
    .from('pack_opens')
    .select(adminPackOpensListSelect(), { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  query = applyFilterPlan(query, params, nowMs)

  const { data, error, count } = await query
  if (error) throw error

  const rows = ((data as PackOpenAdminDbRow[]) ?? []).map(mapPackOpenToAdminListRow)
  return { rows, total: count ?? rows.length }
}

export async function getAdminPackOpenById(id: string): Promise<AdminPackOpenDetailRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_opens')
    .select(adminPackOpensListSelect())
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return mapPackOpenToAdminDetailRow(data as PackOpenAdminDbRow)
}

export async function listAdminPackOpenProducts(): Promise<
  { id: string; slug: string; name: string }[]
> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_products')
    .select('id, slug, name')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as { id: string; slug: string; name: string }[]
}
