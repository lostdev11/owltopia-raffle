/** Max side-prize crypto per milestone (SOL native units). */
export const MILESTONE_MAX_PRIZE_SOL = 10

/** Max milestones on one raffle (ladder cap). */
export const MILESTONE_MAX_PER_RAFFLE = 3

/** USDC cap = 10 SOL equivalent at this fixed rate until live oracle wiring. */
export const MILESTONE_USDC_PER_SOL_EQUIVALENT = 150

export function milestoneMaxPrizeUsdc(): number {
  return MILESTONE_MAX_PRIZE_SOL * MILESTONE_USDC_PER_SOL_EQUIVALENT
}
