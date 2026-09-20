import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type GenOwlRevSharePoolPayoutRow = {
  id: string
  transaction_signature: string
  recipient_wallet: string
  amount_sol: number
  amount_usdc: number
  created_at: string
}

/** Record a successful pool payout. Idempotent on transaction_signature. */
export async function insertGenOwlRevSharePoolPayout(input: {
  transaction_signature: string
  recipient_wallet: string
  amount_sol: number
  amount_usdc: number
}): Promise<GenOwlRevSharePoolPayoutRow | null> {
  const sig = input.transaction_signature.trim()
  if (!sig) return null
  const amountSol = Math.max(0, Number(input.amount_sol) || 0)
  const amountUsdc = Math.max(0, Number(input.amount_usdc) || 0)
  if (amountSol <= 0 && amountUsdc <= 0) return null

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('gen_owl_rev_share_pool_payouts')
    .insert({
      transaction_signature: sig,
      recipient_wallet: input.recipient_wallet.trim(),
      amount_sol: amountSol,
      amount_usdc: amountUsdc,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      const existing = await getGenOwlRevSharePoolPayoutBySignature(sig)
      return existing
    }
    // Table may not be migrated yet — never fail the payout path on ledger write.
    console.error('[gen-owl-rev-share-pool-payouts] insert:', error.message)
    return null
  }
  return {
    id: String(data.id),
    transaction_signature: String(data.transaction_signature),
    recipient_wallet: String(data.recipient_wallet),
    amount_sol: Number(data.amount_sol) || 0,
    amount_usdc: Number(data.amount_usdc) || 0,
    created_at: String(data.created_at),
  }
}

export async function getGenOwlRevSharePoolPayoutBySignature(
  signature: string
): Promise<GenOwlRevSharePoolPayoutRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('gen_owl_rev_share_pool_payouts')
    .select('*')
    .eq('transaction_signature', signature.trim())
    .maybeSingle()
  if (error || !data) return null
  return {
    id: String(data.id),
    transaction_signature: String(data.transaction_signature),
    recipient_wallet: String(data.recipient_wallet),
    amount_sol: Number(data.amount_sol) || 0,
    amount_usdc: Number(data.amount_usdc) || 0,
    created_at: String(data.created_at),
  }
}

/** Sum of all recorded pool payout amounts (for orphan detection vs claim rows). */
export async function sumGenOwlRevSharePoolPayouts(): Promise<{ sol: number; usdc: number }> {
  const db = getSupabaseAdmin()
  const pageSize = 1000
  let sol = 0
  let usdc = 0
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from('gen_owl_rev_share_pool_payouts')
      .select('amount_sol, amount_usdc')
      .range(from, from + pageSize - 1)
    if (error) {
      // Missing table / RLS — treat as no ledger yet.
      if (error.code === '42P01' || /does not exist|schema cache/i.test(error.message)) {
        return { sol: 0, usdc: 0 }
      }
      console.error('[gen-owl-rev-share-pool-payouts] sum:', error.message)
      return { sol, usdc }
    }
    const rows = data ?? []
    for (const row of rows) {
      sol += Number(row.amount_sol) || 0
      usdc += Number(row.amount_usdc) || 0
    }
    if (rows.length < pageSize) break
    from += pageSize
  }
  return { sol, usdc }
}
