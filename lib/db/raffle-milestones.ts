import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { RaffleMilestone, RaffleMilestoneCreateInput } from '@/lib/types'

function mapRow(row: Record<string, unknown>): RaffleMilestone {
  return {
    id: String(row.id),
    raffle_id: String(row.raffle_id),
    sort_order: Number(row.sort_order ?? 0),
    trigger_type: row.trigger_type as RaffleMilestone['trigger_type'],
    trigger_value: Number(row.trigger_value),
    prize_type: row.prize_type as RaffleMilestone['prize_type'],
    prize_amount: row.prize_amount != null ? Number(row.prize_amount) : null,
    prize_currency: (row.prize_currency as RaffleMilestone['prize_currency']) ?? null,
    nft_mint_address: row.nft_mint_address != null ? String(row.nft_mint_address) : null,
    nft_token_id: row.nft_token_id != null ? String(row.nft_token_id) : null,
    winner_mode: row.winner_mode as RaffleMilestone['winner_mode'],
    status: row.status as RaffleMilestone['status'],
    unlocked_at: row.unlocked_at != null ? String(row.unlocked_at) : null,
    winner_wallet: row.winner_wallet != null ? String(row.winner_wallet) : null,
    winner_selected_at: row.winner_selected_at != null ? String(row.winner_selected_at) : null,
    winner_selection_mode:
      row.winner_selection_mode != null
        ? (row.winner_selection_mode as RaffleMilestone['winner_selection_mode'])
        : null,
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

export async function getMilestonesByRaffleId(raffleId: string): Promise<RaffleMilestone[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('raffle_milestones')
    .select('*')
    .eq('raffle_id', raffleId)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[raffle_milestones] fetch:', error.message)
    return []
  }
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>))
}

export async function getMilestoneById(milestoneId: string): Promise<RaffleMilestone | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('raffle_milestones')
    .select('*')
    .eq('id', milestoneId)
    .maybeSingle()

  if (error || !data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function insertRaffleMilestones(
  raffleId: string,
  inputs: RaffleMilestoneCreateInput[]
): Promise<RaffleMilestone[]> {
  if (inputs.length === 0) return []
  const now = new Date().toISOString()
  const rows = inputs.map((m, i) => ({
    raffle_id: raffleId,
    sort_order: i,
    trigger_type: m.trigger_type,
    trigger_value: m.trigger_value,
    prize_type: m.prize_type,
    prize_amount: m.prize_type === 'crypto' ? m.prize_amount : null,
    prize_currency: m.prize_type === 'crypto' ? m.prize_currency : null,
    nft_mint_address: m.prize_type === 'nft' ? m.nft_mint_address ?? null : null,
    nft_token_id: m.prize_type === 'nft' ? m.nft_token_id ?? null : null,
    winner_mode: m.winner_mode,
    status: 'pending',
    created_at: now,
    updated_at: now,
  }))

  const { data, error } = await getSupabaseAdmin().from('raffle_milestones').insert(rows).select('*')
  if (error) {
    throw new Error(`Failed to insert milestones: ${error.message}`)
  }
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>))
}

export async function updateRaffleMilestone(
  milestoneId: string,
  patch: Partial<
    Pick<
      RaffleMilestone,
      | 'status'
      | 'unlocked_at'
      | 'winner_wallet'
      | 'winner_selected_at'
      | 'winner_selection_mode'
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
    .from('raffle_milestones')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', milestoneId)
  if (error) {
    throw new Error(`Failed to update milestone: ${error.message}`)
  }
}

export async function allMilestonesDeposited(raffleId: string): Promise<boolean> {
  const milestones = await getMilestonesByRaffleId(raffleId)
  if (milestones.length === 0) return true
  return milestones.every((m) => !!m.deposit_verified_at)
}

export async function getPriorMilestoneWinnerWallets(
  raffleId: string,
  beforeSortOrder: number
): Promise<Set<string>> {
  const milestones = await getMilestonesByRaffleId(raffleId)
  const set = new Set<string>()
  for (const m of milestones) {
    if (m.sort_order >= beforeSortOrder) break
    if (m.winner_wallet?.trim()) set.add(m.winner_wallet.trim())
  }
  return set
}
