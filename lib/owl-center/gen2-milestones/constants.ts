/** Max side-prize crypto per mint milestone (SOL native units). */
export const GEN2_MILESTONE_MAX_PRIZE_SOL = 10

/** Max mint milestones on one launch (ladder cap). */
export const GEN2_MILESTONE_MAX_PER_LAUNCH = 5

/** USDC cap = 10 SOL equivalent at this fixed rate until live oracle wiring. */
export const GEN2_MILESTONE_USDC_PER_SOL_EQUIVALENT = 150

/**
 * Minimum gap (in mints) a new milestone trigger must sit above the current
 * minted count when added mid-mint, so a fresh milestone can't be "already
 * passed" by the time the creator finishes funding the escrow.
 */
export const GEN2_MILESTONE_ADD_BUFFER = 1

export function gen2MilestoneMaxPrizeUsdc(): number {
  return GEN2_MILESTONE_MAX_PRIZE_SOL * GEN2_MILESTONE_USDC_PER_SOL_EQUIVALENT
}
