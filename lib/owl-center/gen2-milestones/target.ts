import type { Gen2MintMilestone, Gen2MintMilestoneCreateInput } from '@/lib/types'

type TriggerLike = Pick<
  Gen2MintMilestone | Gen2MintMilestoneCreateInput,
  'trigger_type' | 'trigger_value'
>

/**
 * Absolute mint count at which a milestone unlocks.
 * - `absolute_mints`: the value itself.
 * - `percent_supply`: ceil(totalSupply * pct / 100).
 */
export function gen2MilestoneTargetMints(milestone: TriggerLike, totalSupply: number): number {
  if (milestone.trigger_type === 'percent_supply') {
    const supply = Number(totalSupply)
    if (!Number.isFinite(supply) || supply <= 0) return Math.ceil(milestone.trigger_value)
    return Math.max(1, Math.ceil((supply * milestone.trigger_value) / 100))
  }
  return Math.max(1, Math.floor(milestone.trigger_value))
}

export function isGen2MilestoneReachedByMints(
  milestone: TriggerLike,
  totalSupply: number,
  mintedCount: number
): boolean {
  return mintedCount >= gen2MilestoneTargetMints(milestone, totalSupply)
}
