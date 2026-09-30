/**
 * Pure helpers for rev-share deposit bookkeeping.
 * Period totals are additive; claims never shrink deposited books.
 * Homepage schedule updates only touch gens credited by this deposit.
 */

export type RevShareScheduleAmountSlice = {
  gen1_total_sol: number | null
  gen1_total_usdc: number | null
  gen2_total_sol: number | null
  gen2_total_usdc: number | null
  total_sol: number | null
  total_usdc: number | null
}

function numOrZero(n: number | null | undefined): number {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** next = previous + credit (credit ignored when ≤ 0). */
export function addGenOwlRevSharePeriodCredit(params: {
  previous: {
    gen1_total_sol?: number | null
    gen1_total_usdc?: number | null
    gen2_total_sol?: number | null
    gen2_total_usdc?: number | null
  } | null
  addGen1Sol: number
  addGen2Sol: number
  addGen1Usdc: number
  addGen2Usdc: number
}): {
  gen1_total_sol: number
  gen2_total_sol: number
  gen1_total_usdc: number
  gen2_total_usdc: number
  total_sol: number
  total_usdc: number
} {
  const gen1_total_sol = numOrZero(params.previous?.gen1_total_sol) + Math.max(0, params.addGen1Sol)
  const gen2_total_sol = numOrZero(params.previous?.gen2_total_sol) + Math.max(0, params.addGen2Sol)
  const gen1_total_usdc = numOrZero(params.previous?.gen1_total_usdc) + Math.max(0, params.addGen1Usdc)
  const gen2_total_usdc = numOrZero(params.previous?.gen2_total_usdc) + Math.max(0, params.addGen2Usdc)
  return {
    gen1_total_sol,
    gen2_total_sol,
    gen1_total_usdc,
    gen2_total_usdc,
    total_sol: gen1_total_sol + gen2_total_sol,
    total_usdc: gen1_total_usdc + gen2_total_usdc,
  }
}

/**
 * Homepage schedule after a deposit: only overwrite gens this deposit credited.
 * Prevents Gen1-only funding from zeroing Gen2 display (and vice versa) when
 * gens are funded into different period months.
 */
export function mergeRevShareScheduleAmountsAfterDeposit(params: {
  schedule: Partial<RevShareScheduleAmountSlice> | null | undefined
  addGen1Sol: number
  addGen2Sol: number
  addGen1Usdc: number
  addGen2Usdc: number
  nextPeriodGen1Sol: number
  nextPeriodGen2Sol: number
  nextPeriodGen1Usdc: number
  nextPeriodGen2Usdc: number
}): {
  gen1_total_sol?: number
  gen1_total_usdc?: number
  gen2_total_sol?: number
  gen2_total_usdc?: number
  total_sol: number
  total_usdc: number
} {
  const touchedGen1 = params.addGen1Sol > 0 || params.addGen1Usdc > 0
  const touchedGen2 = params.addGen2Sol > 0 || params.addGen2Usdc > 0

  const gen1Sol = touchedGen1
    ? params.nextPeriodGen1Sol
    : numOrZero(params.schedule?.gen1_total_sol)
  const gen1Usdc = touchedGen1
    ? params.nextPeriodGen1Usdc
    : numOrZero(params.schedule?.gen1_total_usdc)
  const gen2Sol = touchedGen2
    ? params.nextPeriodGen2Sol
    : numOrZero(params.schedule?.gen2_total_sol)
  const gen2Usdc = touchedGen2
    ? params.nextPeriodGen2Usdc
    : numOrZero(params.schedule?.gen2_total_usdc)

  const out: {
    gen1_total_sol?: number
    gen1_total_usdc?: number
    gen2_total_sol?: number
    gen2_total_usdc?: number
    total_sol: number
    total_usdc: number
  } = {
    total_sol: gen1Sol + gen2Sol,
    total_usdc: gen1Usdc + gen2Usdc,
  }
  if (touchedGen1) {
    out.gen1_total_sol = gen1Sol
    out.gen1_total_usdc = gen1Usdc
  }
  if (touchedGen2) {
    out.gen2_total_sol = gen2Sol
    out.gen2_total_usdc = gen2Usdc
  }
  return out
}

/**
 * Pre-finalize estimate pool: use deposited period amount when > 0; otherwise
 * fall back to schedule preview. Period 0 must not hide a positive schedule.
 */
export function resolveGenOwlRevShareEstimatePoolAmount(params: {
  periodAmount: number | null | undefined
  scheduleAmount: number | null | undefined
  useSchedulePreview: boolean
}): number {
  const fromPeriod = numOrZero(params.periodAmount)
  if (fromPeriod > 0) return fromPeriod
  if (params.useSchedulePreview) return numOrZero(params.scheduleAmount)
  return 0
}
