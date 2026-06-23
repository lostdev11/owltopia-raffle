import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { Gen2MintMilestone, Gen2MintMilestoneCreateInput } from '@/lib/types'

function mapRow(row: Record<string, unknown>): Gen2MintMilestone {
  return {
    id: String(row.id),
    launch_id: String(row.launch_id),
    sort_order: Number(row.sort_order ?? 0),
    trigger_type: row.trigger_type as Gen2MintMilestone['trigger_type'],
    trigger_value: Number(row.trigger_value),
    prize_type: row.prize_type as Gen2MintMilestone['prize_type'],
    prize_amount: row.prize_amount != null ? Number(row.prize_amount) : null,
    prize_currency: (row.prize_currency as Gen2MintMilestone['prize_currency']) ?? null,
    nft_mint_address: row.nft_mint_address != null ? String(row.nft_mint_address) : null,
    nft_token_id: row.nft_token_id != null ? String(row.nft_token_id) : null,
    winner_mode: row.winner_mode as Gen2MintMilestone['winner_mode'],
    status: row.status as Gen2MintMilestone['status'],
    trigger_mint_target: row.trigger_mint_target != null ? Number(row.trigger_mint_target) : null,
    unlocked_at: row.unlocked_at != null ? String(row.unlocked_at) : null,
    unlocked_at_minted_count:
      row.unlocked_at_minted_count != null ? Number(row.unlocked_at_minted_count) : null,
    winner_wallet: row.winner_wallet != null ? String(row.winner_wallet) : null,
    winner_selected_at: row.winner_selected_at != null ? String(row.winner_selected_at) : null,
    winner_selection_mode:
      row.winner_selection_mode != null
        ? (row.winner_selection_mode as Gen2MintMilestone['winner_selection_mode'])
        : null,
    funded_by_wallet: row.funded_by_wallet != null ? String(row.funded_by_wallet) : null,
    deposit_tx: row.deposit_tx != null ? String(row.deposit_tx) : null,
    deposit_verified_at: row.deposit_verified_at != null ? String(row.deposit_verified_at) : null,
    claim_tx: row.claim_tx != null ? String(row.claim_tx) : null,
    claimed_at: row.claimed_at != null ? String(row.claimed_at) : null,
    returned_at: row.returned_at != null ? String(row.returned_at) : null,
    return_tx: row.return_tx != null ? String(row.return_tx) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export async function getGen2MilestonesByLaunchId(launchId: string): Promise<Gen2MintMilestone[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('gen2_mint_milestones')
    .select('*')
    .eq('launch_id', launchId)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[gen2_mint_milestones] fetch:', error.message)
    return []
  }
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>))
}

export async function getGen2MilestoneById(milestoneId: string): Promise<Gen2MintMilestone | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('gen2_mint_milestones')
    .select('*')
    .eq('id', milestoneId)
    .maybeSingle()

  if (error || !data) return null
  return mapRow(data as Record<string, unknown>)
}

/** Next free sort_order for a launch (append to the ladder). */
async function nextSortOrder(launchId: string): Promise<number> {
  const { data } = await getSupabaseAdmin()
    .from('gen2_mint_milestones')
    .select('sort_order')
    .eq('launch_id', launchId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const top = data ? Number((data as Record<string, unknown>).sort_order ?? -1) : -1
  return Number.isFinite(top) ? top + 1 : 0
}

export async function insertGen2Milestone(params: {
  launchId: string
  input: Gen2MintMilestoneCreateInput
  triggerMintTarget: number
  fundedByWallet: string | null
}): Promise<Gen2MintMilestone> {
  const now = new Date().toISOString()
  const sortOrder = await nextSortOrder(params.launchId)
  const row = {
    launch_id: params.launchId,
    sort_order: sortOrder,
    trigger_type: params.input.trigger_type,
    trigger_value: params.input.trigger_value,
    prize_type: 'crypto',
    prize_amount: params.input.prize_amount,
    prize_currency: params.input.prize_currency,
    winner_mode: params.input.winner_mode,
    status: 'pending',
    trigger_mint_target: params.triggerMintTarget,
    funded_by_wallet: params.fundedByWallet,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await getSupabaseAdmin()
    .from('gen2_mint_milestones')
    .insert(row)
    .select('*')
    .single()
  if (error || !data) {
    throw new Error(`Failed to insert mint milestone: ${error?.message ?? 'unknown'}`)
  }
  return mapRow(data as Record<string, unknown>)
}

export async function updateGen2Milestone(
  milestoneId: string,
  patch: Partial<
    Pick<
      Gen2MintMilestone,
      | 'status'
      | 'unlocked_at'
      | 'unlocked_at_minted_count'
      | 'winner_wallet'
      | 'winner_selected_at'
      | 'winner_selection_mode'
      | 'funded_by_wallet'
      | 'deposit_tx'
      | 'deposit_verified_at'
      | 'claim_tx'
      | 'claimed_at'
      | 'returned_at'
      | 'return_tx'
    >
  >
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('gen2_mint_milestones')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', milestoneId)
  if (error) {
    throw new Error(`Failed to update mint milestone: ${error.message}`)
  }
}

/**
 * Optimistic-concurrency transition guarded by the expected current status.
 * Returns the updated row only if THIS caller won the race (status matched).
 * Used so concurrent confirm-mint calls can't double-process a milestone.
 */
export async function transitionGen2MilestoneStatus(
  milestoneId: string,
  fromStatus: Gen2MintMilestone['status'],
  patch: Partial<
    Pick<
      Gen2MintMilestone,
      | 'status'
      | 'unlocked_at'
      | 'unlocked_at_minted_count'
      | 'winner_wallet'
      | 'winner_selected_at'
      | 'winner_selection_mode'
    >
  >
): Promise<Gen2MintMilestone | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('gen2_mint_milestones')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', milestoneId)
    .eq('status', fromStatus)
    .select('*')
    .maybeSingle()
  if (error || !data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function deleteGen2Milestone(milestoneId: string): Promise<boolean> {
  const { error, count } = await getSupabaseAdmin()
    .from('gen2_mint_milestones')
    .delete({ count: 'exact' })
    .eq('id', milestoneId)
  if (error) {
    console.error('[gen2_mint_milestones] delete:', error.message)
    return false
  }
  return (count ?? 0) > 0
}

/** Wallets that have already won a milestone on this launch (exclude from new draws). */
export async function getPriorGen2MilestoneWinnerWallets(launchId: string): Promise<Set<string>> {
  const milestones = await getGen2MilestonesByLaunchId(launchId)
  const set = new Set<string>()
  for (const m of milestones) {
    if (m.winner_wallet?.trim()) set.add(m.winner_wallet.trim())
  }
  return set
}

export type Gen2MilestoneWinRow = {
  milestone: Gen2MintMilestone
  launchSlug: string
  launchName: string
}

/** Mint milestone side-prizes won by this wallet. */
export async function listGen2MilestoneWinsForWallet(wallet: string): Promise<Gen2MilestoneWinRow[]> {
  const w = wallet.trim()
  if (!w) return []

  const { data, error } = await getSupabaseAdmin()
    .from('gen2_mint_milestones')
    .select('*, owl_center_launches!inner(slug, name)')
    .eq('winner_wallet', w)
    .not('winner_wallet', 'is', null)
    .order('winner_selected_at', { ascending: false })

  if (error) {
    console.error('[gen2_mint_milestones] list wins for wallet:', error.message)
    return []
  }

  return (data ?? []).map((row) => {
    const launch = (row as Record<string, unknown>).owl_center_launches as
      | { slug: string; name: string }
      | null
    const { owl_center_launches: _drop, ...milestoneRow } = row as Record<string, unknown> & {
      owl_center_launches: { slug: string; name: string } | null
    }
    return {
      milestone: mapRow(milestoneRow as Record<string, unknown>),
      launchSlug: launch?.slug ?? '',
      launchName: launch?.name ?? 'Launch',
    }
  })
}
