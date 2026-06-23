import type { Gen2MintMilestone } from '@/lib/types'
import { gen2MilestoneTargetMints } from '@/lib/owl-center/gen2-milestones/target'

export type PublicGen2Milestone = {
  id: string
  sort_order: number
  trigger_type: Gen2MintMilestone['trigger_type']
  trigger_value: number
  target_mints: number
  prize_amount: number | null
  prize_currency: Gen2MintMilestone['prize_currency']
  winner_mode: Gen2MintMilestone['winner_mode']
  status: Gen2MintMilestone['status']
  funded: boolean
  unlocked_at: string | null
  winner_wallet: string | null
  winner_selected_at: string | null
  claimed_at: string | null
}

/** Public-safe milestone for the mint page (no escrow/deposit tx details). */
export function toPublicGen2Milestone(m: Gen2MintMilestone, totalSupply: number): PublicGen2Milestone {
  return {
    id: m.id,
    sort_order: m.sort_order,
    trigger_type: m.trigger_type,
    trigger_value: m.trigger_value,
    target_mints: m.trigger_mint_target ?? gen2MilestoneTargetMints(m, totalSupply),
    prize_amount: m.prize_amount,
    prize_currency: m.prize_currency,
    winner_mode: m.winner_mode,
    status: m.status,
    funded: !!m.deposit_verified_at,
    unlocked_at: m.unlocked_at,
    winner_wallet: m.winner_wallet,
    winner_selected_at: m.winner_selected_at,
    claimed_at: m.claimed_at,
  }
}

export type ManageGen2Milestone = PublicGen2Milestone & {
  funded_by_wallet: string | null
  deposit_tx: string | null
  deposit_verified_at: string | null
  return_tx: string | null
  returned_at: string | null
  created_at: string
}

/** Manager view (admin/creator) — includes funding/deposit details. */
export function toManageGen2Milestone(m: Gen2MintMilestone, totalSupply: number): ManageGen2Milestone {
  return {
    ...toPublicGen2Milestone(m, totalSupply),
    funded_by_wallet: m.funded_by_wallet,
    deposit_tx: m.deposit_tx,
    deposit_verified_at: m.deposit_verified_at,
    return_tx: m.return_tx,
    returned_at: m.returned_at,
    created_at: m.created_at,
  }
}
