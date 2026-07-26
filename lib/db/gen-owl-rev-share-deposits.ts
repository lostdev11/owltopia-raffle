import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type GenOwlRevShareDepositRow = {
  id: string
  period_month: string
  currency: 'SOL' | 'USDC'
  amount: number
  gen1_amount: number
  gen2_amount: number
  transaction_signature: string
  depositor_wallet: string
  created_at: string
}

function mapRow(data: Record<string, unknown>): GenOwlRevShareDepositRow {
  return {
    id: String(data.id),
    period_month: String(data.period_month),
    currency: String(data.currency).toUpperCase() === 'USDC' ? 'USDC' : 'SOL',
    amount: Number(data.amount),
    gen1_amount: Number(data.gen1_amount ?? 0),
    gen2_amount: Number(data.gen2_amount ?? 0),
    transaction_signature: String(data.transaction_signature),
    depositor_wallet: String(data.depositor_wallet),
    created_at: String(data.created_at ?? new Date().toISOString()),
  }
}

export async function getGenOwlRevShareDepositBySignature(
  signature: string
): Promise<GenOwlRevShareDepositRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('gen_owl_rev_share_deposits')
    .select('*')
    .eq('transaction_signature', signature.trim())
    .maybeSingle()
  if (error || !data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function insertGenOwlRevShareDeposit(input: {
  period_month: string
  currency: 'SOL' | 'USDC'
  amount: number
  gen1_amount: number
  gen2_amount: number
  transaction_signature: string
  depositor_wallet: string
}): Promise<GenOwlRevShareDepositRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('gen_owl_rev_share_deposits')
    .insert({
      period_month: input.period_month.trim(),
      currency: input.currency,
      amount: input.amount,
      gen1_amount: input.gen1_amount,
      gen2_amount: input.gen2_amount,
      transaction_signature: input.transaction_signature.trim(),
      depositor_wallet: input.depositor_wallet.trim(),
    })
    .select('*')
    .single()

  if (error) {
    // Unique violation — race with idempotent retry
    if (error.code === '23505') {
      return getGenOwlRevShareDepositBySignature(input.transaction_signature)
    }
    console.error('[gen-owl-rev-share-deposits] insert:', error.message)
    return null
  }
  return mapRow(data as Record<string, unknown>)
}
