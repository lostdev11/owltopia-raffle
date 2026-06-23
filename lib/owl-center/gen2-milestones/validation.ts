import type { Gen2MintMilestoneCreateInput } from '@/lib/types'
import {
  GEN2_MILESTONE_ADD_BUFFER,
  GEN2_MILESTONE_MAX_PRIZE_SOL,
  gen2MilestoneMaxPrizeUsdc,
} from '@/lib/owl-center/gen2-milestones/constants'
import { gen2MilestoneTargetMints } from '@/lib/owl-center/gen2-milestones/target'

export type Gen2MilestoneValidationResult =
  | { ok: true; milestone: Gen2MintMilestoneCreateInput; target: number }
  | { ok: false; error: string }

/** Parse + validate a single milestone the admin/creator is adding. */
export function parseGen2MilestoneInput(raw: unknown): Gen2MintMilestoneCreateInput | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const trigger_type = o.trigger_type
  if (trigger_type !== 'absolute_mints' && trigger_type !== 'percent_supply') return null

  const winner_mode = o.winner_mode === 'top_buyer' ? 'top_buyer' : 'random'

  const trigger_value =
    typeof o.trigger_value === 'number' ? o.trigger_value : parseFloat(String(o.trigger_value ?? ''))
  if (!Number.isFinite(trigger_value) || trigger_value <= 0) return null
  if (trigger_type === 'percent_supply' && trigger_value > 100) return null

  const prize_amount =
    typeof o.prize_amount === 'number' ? o.prize_amount : parseFloat(String(o.prize_amount ?? ''))
  if (!Number.isFinite(prize_amount) || prize_amount <= 0) return null

  const prize_currency =
    typeof o.prize_currency === 'string' ? o.prize_currency.trim().toUpperCase() : ''
  if (prize_currency !== 'SOL' && prize_currency !== 'USDC') return null

  return {
    trigger_type,
    trigger_value,
    prize_amount,
    prize_currency,
    winner_mode,
  }
}

/**
 * Validate a single milestone for a launch.
 *
 * @param totalSupply launch total supply (for percent triggers + max-target checks)
 * @param mintedCount current minted count (mid-mint adds must sit above this)
 * @param existingTargets absolute mint targets already configured on the launch (dedupe)
 */
export function validateGen2Milestone(params: {
  raw: unknown
  totalSupply: number
  mintedCount: number
  existingTargets: number[]
}): Gen2MilestoneValidationResult {
  const milestone = parseGen2MilestoneInput(params.raw)
  if (!milestone) {
    return { ok: false, error: 'Invalid milestone — set a trigger, prize amount, and currency.' }
  }

  if (milestone.prize_currency === 'SOL' && milestone.prize_amount > GEN2_MILESTONE_MAX_PRIZE_SOL) {
    return { ok: false, error: `Prize cannot exceed ${GEN2_MILESTONE_MAX_PRIZE_SOL} SOL.` }
  }
  if (milestone.prize_currency === 'USDC' && milestone.prize_amount > gen2MilestoneMaxPrizeUsdc()) {
    return { ok: false, error: `Prize cannot exceed ${gen2MilestoneMaxPrizeUsdc()} USDC.` }
  }

  const totalSupply = Number(params.totalSupply)
  const target = gen2MilestoneTargetMints(milestone, totalSupply)

  if (Number.isFinite(totalSupply) && totalSupply > 0 && target > totalSupply) {
    return { ok: false, error: `Milestone target (${target}) exceeds total supply (${totalSupply}).` }
  }

  const minTarget = params.mintedCount + GEN2_MILESTONE_ADD_BUFFER
  if (target < minTarget) {
    return {
      ok: false,
      error: `Milestone target (${target}) must be above the current mint count (${params.mintedCount}). Pick a future milestone.`,
    }
  }

  if (params.existingTargets.includes(target)) {
    return { ok: false, error: `A milestone at ${target} mints already exists.` }
  }

  return { ok: true, milestone, target }
}
