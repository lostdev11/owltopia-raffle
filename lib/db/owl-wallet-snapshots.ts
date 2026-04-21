/**
 * Persisted OWL balance snapshots (7-day TTL enforced in application layer).
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type OwlWalletOwlSnapshotRow = {
  wallet_address: string
  balance_raw: string
  meets_min_proposal: boolean
  checked_at: string
}

export async function getOwlWalletSnapshot(
  walletAddress: string
): Promise<OwlWalletOwlSnapshotRow | null> {
  const w = walletAddress.trim()
  if (!w) return null

  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('owl_wallet_owl_snapshots')
      .select('wallet_address, balance_raw, meets_min_proposal, checked_at')
      .eq('wallet_address', w)
      .maybeSingle()

    if (error || !data) return null
    return data as OwlWalletOwlSnapshotRow
  } catch {
    return null
  }
}

export async function upsertOwlWalletSnapshot(params: {
  walletAddress: string
  balanceRaw: bigint
  meetsMinProposal: boolean
}): Promise<void> {
  const w = params.walletAddress.trim()
  if (!w) return

  try {
    const admin = getSupabaseAdmin()
    const { error } = await admin.from('owl_wallet_owl_snapshots').upsert(
      {
        wallet_address: w,
        balance_raw: params.balanceRaw.toString(),
        meets_min_proposal: params.meetsMinProposal,
        checked_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address' }
    )
    if (error) console.warn('[owl_wallet_owl_snapshots] upsert:', error.message)
  } catch (e) {
    console.warn('[owl_wallet_owl_snapshots] upsert:', e instanceof Error ? e.message : e)
  }
}
