/**
 * Compute-budget helpers for Switchboard On-Demand VRF txs.
 *
 * Switchboard's asV0Tx sets CU limit to floor(simConsumed * multiple) with no
 * floor and no check that simulation succeeded. RandomnessCommit has been
 * observed exhausting exactly that limit (~8648 with 1.3×) on pack opens —
 * sim under-counts vs preflight/execution.
 */

/** Priority fee (micro-lamports / CU) used for commit / reveal. */
export const SWITCHBOARD_TX_CU_PRICE = 75_000

/**
 * Safety multiplier over simulated CU. 1.3 was too tight for RandomnessCommit
 * (prod failure: consumed 8648 of 8648).
 */
export const SWITCHBOARD_TX_CU_LIMIT_MULTIPLE = 2.5

/**
 * Absolute floor so a low sim never pins the limit near the execution cliff.
 * Still cheap at 75k µLamports/CU (~0.00375 SOL priority fee at the floor).
 */
export const SWITCHBOARD_TX_CU_MIN = 50_000

export const SWITCHBOARD_TX_CU_MAX = 1_400_000

/**
 * Resolve the SetComputeUnitLimit value from a successful simulation.
 */
export function resolveSwitchboardComputeUnitLimit(params: {
  unitsConsumed: number | null | undefined
  multiple?: number
  minUnits?: number
  maxUnits?: number
}): number {
  const multiple = params.multiple ?? SWITCHBOARD_TX_CU_LIMIT_MULTIPLE
  const minUnits = params.minUnits ?? SWITCHBOARD_TX_CU_MIN
  const maxUnits = params.maxUnits ?? SWITCHBOARD_TX_CU_MAX
  const consumed = Number(params.unitsConsumed)
  if (!Number.isFinite(consumed) || consumed <= 0) {
    return Math.min(maxUnits, Math.max(minUnits, SWITCHBOARD_TX_CU_MIN))
  }
  const scaled = Math.floor(consumed * multiple)
  return Math.min(maxUnits, Math.max(minUnits, scaled))
}

/** True when a Solana simulation / send error looks like CU exhaustion. */
export function isComputeUnitExhaustedError(message: string): boolean {
  return /exceeded CUs meter|computational budget exceeded|max.*compute.*units/i.test(
    message
  )
}
