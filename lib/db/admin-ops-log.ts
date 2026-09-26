import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { AdminOpsLogAsset, AdminOpsLogStatus, AdminOpsLogType } from '@/lib/admin-ops-log/constants'
import type {
  AdminOpsLogRow,
  CreateAdminOpsLogParams,
  ListAdminOpsLogParams,
  UpdateAdminOpsLogParams,
} from '@/lib/admin-ops-log/types'

export {
  ADMIN_OPS_LOG_ASSETS,
  ADMIN_OPS_LOG_STATUSES,
  ADMIN_OPS_LOG_TYPES,
  type AdminOpsLogAsset,
  type AdminOpsLogStatus,
  type AdminOpsLogType,
} from '@/lib/admin-ops-log/constants'

export type {
  AdminOpsLogRow,
  CreateAdminOpsLogParams,
  ListAdminOpsLogParams,
  UpdateAdminOpsLogParams,
} from '@/lib/admin-ops-log/types'

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function mapRow(raw: Record<string, unknown>): AdminOpsLogRow {
  return {
    id: String(raw.id),
    occurred_at: String(raw.occurred_at),
    type: raw.type as AdminOpsLogType,
    title: String(raw.title),
    who: typeof raw.who === 'string' ? raw.who : null,
    wallet: typeof raw.wallet === 'string' ? raw.wallet : null,
    amount: parseAmount(raw.amount),
    asset: (raw.asset as AdminOpsLogAsset | null) ?? null,
    from_wallet: typeof raw.from_wallet === 'string' ? raw.from_wallet : null,
    tx_signature: typeof raw.tx_signature === 'string' ? raw.tx_signature : null,
    related: typeof raw.related === 'string' ? raw.related : null,
    status: raw.status as AdminOpsLogStatus,
    notes: typeof raw.notes === 'string' ? raw.notes : null,
    created_by_wallet: String(raw.created_by_wallet),
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
    updated_by_wallet: typeof raw.updated_by_wallet === 'string' ? raw.updated_by_wallet : null,
  }
}

export async function listAdminOpsLog(
  params: ListAdminOpsLogParams
): Promise<{ rows: AdminOpsLogRow[]; total: number }> {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50))
  const offset = Math.max(0, params.offset ?? 0)
  const search = params.search?.trim()

  let query = getSupabaseAdmin()
    .from('admin_ops_log')
    .select('*', { count: 'exact' })
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (params.type) query = query.eq('type', params.type)
  if (params.status) query = query.eq('status', params.status)
  if (search) {
    const safe = search.replace(/[,()]/g, ' ').trim().slice(0, 120)
    if (safe) {
      const pattern = `%${safe}%`
      query = query.or(
        [
          `title.ilike.${pattern}`,
          `who.ilike.${pattern}`,
          `wallet.ilike.${pattern}`,
          `from_wallet.ilike.${pattern}`,
          `tx_signature.ilike.${pattern}`,
          `related.ilike.${pattern}`,
          `notes.ilike.${pattern}`,
        ].join(',')
      )
    }
  }

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  const rows = (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
  return { rows, total: count ?? rows.length }
}

export async function createAdminOpsLog(params: CreateAdminOpsLogParams): Promise<AdminOpsLogRow | null> {
  const title = params.title.trim()
  if (!title) return null

  const payload = {
    occurred_at: params.occurredAt?.trim() || undefined,
    type: params.type,
    title,
    who: params.who?.trim() || null,
    wallet: params.wallet?.trim() || null,
    amount: params.amount ?? null,
    asset: params.asset ?? null,
    from_wallet: params.fromWallet?.trim() || null,
    tx_signature: params.txSignature?.trim() || null,
    related: params.related?.trim() || null,
    status: params.status ?? 'pending',
    notes: params.notes?.trim() || null,
    created_by_wallet: params.createdByWallet.trim(),
    updated_by_wallet: params.createdByWallet.trim(),
  }

  const { data, error } = await getSupabaseAdmin()
    .from('admin_ops_log')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    console.error('[admin-ops-log] create:', error.message)
    return null
  }
  return mapRow(data as Record<string, unknown>)
}

export async function updateAdminOpsLog(
  id: string,
  params: UpdateAdminOpsLogParams
): Promise<AdminOpsLogRow | null> {
  const entryId = id.trim()
  if (!entryId) return null

  const patch: Record<string, unknown> = {
    updated_by_wallet: params.updatedByWallet.trim(),
  }
  if (params.occurredAt !== undefined) {
    patch.occurred_at = params.occurredAt?.trim() || new Date().toISOString()
  }
  if (params.type !== undefined) patch.type = params.type
  if (params.title !== undefined) patch.title = params.title.trim()
  if (params.who !== undefined) patch.who = params.who?.trim() || null
  if (params.wallet !== undefined) patch.wallet = params.wallet?.trim() || null
  if (params.amount !== undefined) patch.amount = params.amount
  if (params.asset !== undefined) patch.asset = params.asset
  if (params.fromWallet !== undefined) patch.from_wallet = params.fromWallet?.trim() || null
  if (params.txSignature !== undefined) patch.tx_signature = params.txSignature?.trim() || null
  if (params.related !== undefined) patch.related = params.related?.trim() || null
  if (params.status !== undefined) patch.status = params.status
  if (params.notes !== undefined) patch.notes = params.notes?.trim() || null

  const { data, error } = await getSupabaseAdmin()
    .from('admin_ops_log')
    .update(patch)
    .eq('id', entryId)
    .select('*')
    .single()

  if (error) {
    console.error('[admin-ops-log] update:', error.message)
    return null
  }
  return mapRow(data as Record<string, unknown>)
}

export async function deleteAdminOpsLog(id: string): Promise<boolean> {
  const entryId = id.trim()
  if (!entryId) return false
  const { error } = await getSupabaseAdmin().from('admin_ops_log').delete().eq('id', entryId)
  if (error) {
    console.error('[admin-ops-log] delete:', error.message)
    return false
  }
  return true
}

/** Optional hook for future admin payout flows (packs resolve-open, etc.). */
export async function insertAdminOpsLogAuto(params: CreateAdminOpsLogParams): Promise<void> {
  try {
    await createAdminOpsLog(params)
  } catch (e) {
    console.error('[admin-ops-log] auto-insert failed:', e)
  }
}
