import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'

export type GenOwlRevShareClaimRow = {
  id: string
  period_month: string
  position_id: string
  wallet_address: string
  group_key: GenOwlStakingGroupKey
  amount_sol: number
  amount_usdc: number
  sol_transaction_signature: string | null
  usdc_transaction_signature: string | null
  claimed_at: string
}

function mapClaimRow(data: Record<string, unknown>): GenOwlRevShareClaimRow {
  return {
    id: String(data.id),
    period_month: String(data.period_month),
    position_id: String(data.position_id),
    wallet_address: String(data.wallet_address),
    group_key: data.group_key as GenOwlStakingGroupKey,
    amount_sol: Number(data.amount_sol ?? 0),
    amount_usdc: Number(data.amount_usdc ?? 0),
    sol_transaction_signature:
      data.sol_transaction_signature != null ? String(data.sol_transaction_signature) : null,
    usdc_transaction_signature:
      data.usdc_transaction_signature != null ? String(data.usdc_transaction_signature) : null,
    claimed_at: String(data.claimed_at),
  }
}

export async function getGenOwlRevShareClaimForPosition(
  periodMonth: string,
  positionId: string
): Promise<GenOwlRevShareClaimRow | null> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('gen_owl_rev_share_claims')
    .select('*')
    .eq('period_month', periodMonth.trim())
    .eq('position_id', positionId.trim())
    .maybeSingle()
  if (error || !data) return null
  return mapClaimRow(data as Record<string, unknown>)
}

export async function listGenOwlRevShareClaimsForWallet(
  wallet: string,
  periodMonth?: string
): Promise<GenOwlRevShareClaimRow[]> {
  const db = getSupabaseForServerRead(supabase)
  let q = db.from('gen_owl_rev_share_claims').select('*').eq('wallet_address', wallet.trim())
  if (periodMonth?.trim()) q = q.eq('period_month', periodMonth.trim())
  const { data, error } = await q.order('claimed_at', { ascending: false })
  if (error || !data) return []
  return data.map((row) => mapClaimRow(row as Record<string, unknown>))
}

export async function insertGenOwlRevShareClaim(row: {
  period_month: string
  position_id: string
  wallet_address: string
  group_key: GenOwlStakingGroupKey
  amount_sol: number
  amount_usdc: number
  sol_transaction_signature?: string | null
  usdc_transaction_signature?: string | null
}): Promise<GenOwlRevShareClaimRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('gen_owl_rev_share_claims')
    .insert({
      period_month: row.period_month.trim(),
      position_id: row.position_id.trim(),
      wallet_address: row.wallet_address.trim(),
      group_key: row.group_key,
      amount_sol: row.amount_sol,
      amount_usdc: row.amount_usdc,
      sol_transaction_signature: row.sol_transaction_signature?.trim() || null,
      usdc_transaction_signature: row.usdc_transaction_signature?.trim() || null,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[gen-owl-rev-share-claims] insert:', error.message)
    return null
  }
  return mapClaimRow(data as Record<string, unknown>)
}
