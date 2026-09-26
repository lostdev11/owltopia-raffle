import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { AdminOpsLogAsset } from '@/lib/admin-ops-log/constants'
import type {
  AdminOpsLogPaymentRow,
  CreateAdminOpsLogPaymentParams,
  UpdateAdminOpsLogPaymentParams,
} from '@/lib/admin-ops-log/payment-types'
import { isLikelyRealTxSignature } from '@/lib/admin-ops-log/validate-tx-signature'

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function mapPaymentRow(raw: Record<string, unknown>): AdminOpsLogPaymentRow {
  return {
    id: String(raw.id),
    entry_id: String(raw.entry_id),
    amount: parseAmount(raw.amount),
    asset: (raw.asset as AdminOpsLogAsset | null) ?? null,
    from_wallet: typeof raw.from_wallet === 'string' ? raw.from_wallet : null,
    to_wallet: typeof raw.to_wallet === 'string' ? raw.to_wallet : null,
    tx_signature: typeof raw.tx_signature === 'string' ? raw.tx_signature : null,
    related_pack_open_id:
      typeof raw.related_pack_open_id === 'string' ? raw.related_pack_open_id : null,
    note: typeof raw.note === 'string' ? raw.note : null,
    created_by_wallet: String(raw.created_by_wallet),
    created_at: String(raw.created_at),
  }
}

export async function listAdminOpsLogPayments(entryId: string): Promise<AdminOpsLogPaymentRow[]> {
  const id = entryId.trim()
  if (!id) return []
  const { data, error } = await getSupabaseAdmin()
    .from('admin_ops_log_payments')
    .select('*')
    .eq('entry_id', id)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapPaymentRow(r as Record<string, unknown>))
}

export async function listAdminOpsLogPaymentsForEntries(
  entryIds: string[]
): Promise<AdminOpsLogPaymentRow[]> {
  const ids = [...new Set(entryIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return []
  const { data, error } = await getSupabaseAdmin()
    .from('admin_ops_log_payments')
    .select('*')
    .in('entry_id', ids)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapPaymentRow(r as Record<string, unknown>))
}

export async function createAdminOpsLogPayment(
  params: CreateAdminOpsLogPaymentParams
): Promise<AdminOpsLogPaymentRow | null> {
  const entryId = params.entryId.trim()
  if (!entryId) return null

  const payload = {
    entry_id: entryId,
    amount: params.amount ?? null,
    asset: params.asset ?? null,
    from_wallet: params.fromWallet?.trim() || null,
    to_wallet: params.toWallet?.trim() || null,
    tx_signature: params.txSignature?.trim() || null,
    related_pack_open_id: params.relatedPackOpenId?.trim() || null,
    note: params.note?.trim() || null,
    created_by_wallet: params.createdByWallet.trim(),
  }

  const { data, error } = await getSupabaseAdmin()
    .from('admin_ops_log_payments')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    console.error('[admin-ops-log-payments] create:', error.message)
    return null
  }
  return mapPaymentRow(data as Record<string, unknown>)
}

export async function updateAdminOpsLogPayment(
  paymentId: string,
  params: UpdateAdminOpsLogPaymentParams
): Promise<AdminOpsLogPaymentRow | null> {
  const id = paymentId.trim()
  if (!id) return null

  const patch: Record<string, unknown> = {}
  if (params.amount !== undefined) patch.amount = params.amount
  if (params.asset !== undefined) patch.asset = params.asset
  if (params.fromWallet !== undefined) patch.from_wallet = params.fromWallet?.trim() || null
  if (params.toWallet !== undefined) patch.to_wallet = params.toWallet?.trim() || null
  if (params.txSignature !== undefined) patch.tx_signature = params.txSignature?.trim() || null
  if (params.relatedPackOpenId !== undefined) {
    patch.related_pack_open_id = params.relatedPackOpenId?.trim() || null
  }
  if (params.note !== undefined) patch.note = params.note?.trim() || null

  const { data, error } = await getSupabaseAdmin()
    .from('admin_ops_log_payments')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    console.error('[admin-ops-log-payments] update:', error.message)
    return null
  }
  return mapPaymentRow(data as Record<string, unknown>)
}

export async function getAdminOpsLogPaymentById(
  paymentId: string
): Promise<AdminOpsLogPaymentRow | null> {
  const id = paymentId.trim()
  if (!id) return null
  const { data, error } = await getSupabaseAdmin()
    .from('admin_ops_log_payments')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[admin-ops-log-payments] get:', error.message)
    return null
  }
  if (!data) return null
  return mapPaymentRow(data as Record<string, unknown>)
}

export async function deleteAdminOpsLogPayment(paymentId: string): Promise<boolean> {
  const id = paymentId.trim()
  if (!id) return false
  const { error } = await getSupabaseAdmin()
    .from('admin_ops_log_payments')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('[admin-ops-log-payments] delete:', error.message)
    return false
  }
  return true
}

export type TxSignatureDuplicateHit = {
  source: 'payment' | 'legacy_entry'
  entry_id: string
  payment_id?: string
}

/** Returns first duplicate match anywhere in ops log (payments table or legacy entry column). */
export async function findDuplicateOpsLogTxSignature(
  txSignature: string,
  opts?: { excludePaymentId?: string; excludeEntryId?: string }
): Promise<TxSignatureDuplicateHit | null> {
  const sig = txSignature.trim()
  if (!isLikelyRealTxSignature(sig)) return null

  let paymentQuery = getSupabaseAdmin()
    .from('admin_ops_log_payments')
    .select('id, entry_id')
    .eq('tx_signature', sig)
    .limit(1)
  if (opts?.excludePaymentId?.trim()) {
    paymentQuery = paymentQuery.neq('id', opts.excludePaymentId.trim())
  }
  const { data: paymentHit, error: paymentErr } = await paymentQuery
  if (paymentErr) throw new Error(paymentErr.message)
  const p = paymentHit?.[0] as { id?: string; entry_id?: string } | undefined
  if (p?.entry_id) {
    return { source: 'payment', entry_id: String(p.entry_id), payment_id: p.id ? String(p.id) : undefined }
  }

  let legacyQuery = getSupabaseAdmin()
    .from('admin_ops_log')
    .select('id')
    .eq('tx_signature', sig)
    .limit(1)
  if (opts?.excludeEntryId?.trim()) {
    legacyQuery = legacyQuery.neq('id', opts.excludeEntryId.trim())
  }
  const { data: legacyHit, error: legacyErr } = await legacyQuery
  if (legacyErr) throw new Error(legacyErr.message)
  const l = legacyHit?.[0] as { id?: string } | undefined
  if (l?.id) {
    return { source: 'legacy_entry', entry_id: String(l.id) }
  }

  return null
}

export async function adminOpsLogEntryExists(entryId: string): Promise<boolean> {
  const id = entryId.trim()
  if (!id) return false
  const { data, error } = await getSupabaseAdmin()
    .from('admin_ops_log')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return !!data
}

/** Mirror legacy entry money fields into the payments table when present. */
export async function mirrorLegacyEntryFieldsToPayment(input: {
  entryId: string
  amount: number | null
  asset: AdminOpsLogAsset | null
  fromWallet: string | null
  toWallet: string | null
  txSignature: string | null
  relatedPackOpenId?: string | null
  createdByWallet: string
  createdAt?: string
}): Promise<void> {
  const hasAmount = input.amount != null
  const hasTx = isLikelyRealTxSignature(input.txSignature)
  if (!hasAmount && !hasTx) return

  const payload: Record<string, unknown> = {
    entry_id: input.entryId.trim(),
    amount: input.amount,
    asset: input.asset,
    from_wallet: input.fromWallet?.trim() || null,
    to_wallet: input.toWallet?.trim() || null,
    tx_signature: input.txSignature?.trim() || null,
    related_pack_open_id: input.relatedPackOpenId?.trim() || null,
    created_by_wallet: input.createdByWallet.trim(),
  }
  if (input.createdAt) payload.created_at = input.createdAt

  const { error } = await getSupabaseAdmin().from('admin_ops_log_payments').insert(payload)
  if (error) {
    console.error('[admin-ops-log-payments] mirror legacy:', error.message)
  }
}
