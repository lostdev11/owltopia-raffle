import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { markPositionUnstaked } from '@/lib/db/staking-positions'
import type { StakingPositionRow } from '@/lib/db/staking-positions'

export type ClearCrossWalletStaleNestResult = {
  positionId: string
  asset_identifier: string | null
  prior_wallet: string
  cleared: boolean
}

/**
 * Closes open nest rows on *other* wallets when the NFT is currently owned by `holderWallet`
 * (common after wallet migration / transfer without unstaking).
 */
export async function clearCrossWalletStaleNestsForHolder(
  holderWallet: string,
  assetMints: string[]
): Promise<{ results: ClearCrossWalletStaleNestResult[]; cleared_count: number }> {
  const wallet = holderWallet.trim()
  const mints = [...new Set(assetMints.map((m) => m.trim()).filter(Boolean))]
  if (!wallet || mints.length === 0) {
    return { results: [], cleared_count: 0 }
  }

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_positions')
    .select('*')
    .in('asset_identifier', mints)
    .in('status', ['active', 'pending'])
    .neq('wallet_address', wallet)

  if (error) throw new Error(error.message)

  const results: ClearCrossWalletStaleNestResult[] = []
  let clearedCount = 0

  for (const row of (data ?? []) as StakingPositionRow[]) {
    const priorWallet = row.wallet_address.trim()
    const base = {
      positionId: row.id,
      asset_identifier: row.asset_identifier,
      prior_wallet: priorWallet,
      cleared: false as const,
    }

    await markPositionUnstaked(row.id, priorWallet, {
      sync_status: 'confirmed',
      last_synced_at: new Date().toISOString(),
      last_transaction_error: null,
      external_reference: 'support_prior_wallet_holder_cleared',
    })
    results.push({ ...base, cleared: true })
    clearedCount += 1
  }

  return { results, cleared_count: clearedCount }
}
