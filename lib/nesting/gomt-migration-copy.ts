/** Holder-facing policy copy — Gembird-approved July 2026. */

export const GOMT_MIGRATION_OPTIONAL =
  'Moving to Owltopia nesting is optional. You only need to act if you want to keep staking your owl after your current lock ends.'

export const GOMT_RESTAKE_REQUIRED_IF_CONTINUING =
  'To nest on Owltopia, unstake on GOMT Labz first (or wait until your GOMT lock ends). Owltopia nests start fresh — new lock timer and new rewards. Prior GOMT staking time does not carry over.'

export const GEN1_UNLOCK_TIMING =
  'Unlock dates are per holder, based on when you originally staked. Early GOMT staking started in January with 180-day locks, so the first unlocks roll through over time — not one shared date for everyone.'

export const OWL_REWARDS_CLAIM_BASED =
  'Daily OWL accrues while nested, but you claim it yourself from My nest — it is not airdropped automatically.'

export const GOMT_MIGRATION_FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'Do I have to move from GOMT Labz to Owltopia?',
    a: `${GOMT_MIGRATION_OPTIONAL} ${GOMT_RESTAKE_REQUIRED_IF_CONTINUING}`,
  },
  {
    q: 'When do Gen 1 locks from the original staking period expire?',
    a: GEN1_UNLOCK_TIMING,
  },
  {
    q: 'Are OWL rewards automatic or do I claim them?',
    a: OWL_REWARDS_CLAIM_BASED,
  },
]
