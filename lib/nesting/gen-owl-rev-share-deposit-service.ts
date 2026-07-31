import { getGenOwlRevShareDepositBySignature, insertGenOwlRevShareDeposit } from '@/lib/db/gen-owl-rev-share-deposits'
import {
  getGenOwlRevSharePeriod,
  upsertGenOwlRevSharePeriodTotals,
  type GenOwlRevSharePeriodRow,
} from '@/lib/db/gen-owl-rev-share-periods'
import { getRevShareSchedule, updateRevShareSchedule } from '@/lib/db/rev-share-schedule'
import { getGenOwlRevSharePoolPublicKey } from '@/lib/nesting/gen-owl-rev-share-pool'
import {
  formatPeriodMonthUtc,
  periodMonthFromScheduleDate,
} from '@/lib/nesting/gen-owl-rev-share-month'
import { verifyGenOwlRevSharePoolDepositTx } from '@/lib/nesting/verify-gen-owl-rev-share-deposit'
import { StakingUserError } from '@/lib/nesting/errors'

function numOrZero(n: number | null | undefined): number {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** Fat-finger / abuse ceiling for a single deposit credit. */
const MAX_DEPOSIT_SOL = 1_000
const MAX_DEPOSIT_USDC = 1_000_000

/**
 * Prefer explicit period_month; otherwise map single-gen deposits to that gen's
 * schedule next-date month (so Gen 2 August funding is not forced into July).
 */
export function resolveGenOwlRevShareDepositPeriodMonth(params: {
  period_month?: string | null
  gen1_total_sol?: number | null
  gen1_total_usdc?: number | null
  gen2_total_sol?: number | null
  gen2_total_usdc?: number | null
  gen1_next_date?: string | null
  gen2_next_date?: string | null
  now?: Date
}): string {
  const explicit = params.period_month?.trim()
  if (explicit) return explicit

  const gen1Sol = numOrZero(params.gen1_total_sol)
  const gen2Sol = numOrZero(params.gen2_total_sol)
  const gen1Usdc = numOrZero(params.gen1_total_usdc)
  const gen2Usdc = numOrZero(params.gen2_total_usdc)
  const hasGen1 = gen1Sol > 0 || gen1Usdc > 0
  const hasGen2 = gen2Sol > 0 || gen2Usdc > 0

  if (hasGen2 && !hasGen1) {
    const fromGen2 = periodMonthFromScheduleDate(params.gen2_next_date)
    if (fromGen2) return fromGen2
  }
  if (hasGen1 && !hasGen2) {
    const fromGen1 = periodMonthFromScheduleDate(params.gen1_next_date)
    if (fromGen1) return fromGen1
  }

  return formatPeriodMonthUtc(params.now ?? new Date())
}

export type GenOwlRevShareDepositConfirmResult = {
  period_month: string
  period: GenOwlRevSharePeriodRow
  already_recorded: boolean
  sol_signature: string | null
  usdc_signature: string | null
}

/**
 * Verify admin deposit tx(s) into the rev-share pool, record ledger rows, and add to period totals.
 * Amounts are additive. Replaying the same signature is idempotent (no double-count).
 */
export async function confirmGenOwlRevSharePoolDeposit(params: {
  depositorWallet: string
  period_month?: string | null
  gen1_total_sol?: number | null
  gen1_total_usdc?: number | null
  gen2_total_sol?: number | null
  gen2_total_usdc?: number | null
  sol_signature?: string | null
  usdc_signature?: string | null
  gen1_next_date?: string | null
  gen2_next_date?: string | null
  /** Admin replay of an already-broadcast deposit (Solscan / delayed confirm). */
  allow_older_tx?: boolean
}): Promise<GenOwlRevShareDepositConfirmResult> {
  const poolWallet = getGenOwlRevSharePoolPublicKey()
  if (!poolWallet) {
    throw new StakingUserError(
      'Rev share pool is not configured. Set GEN_OWL_REV_SHARE_POOL_SECRET_KEY.',
      503
    )
  }

  const periodMonth = resolveGenOwlRevShareDepositPeriodMonth({
    period_month: params.period_month,
    gen1_total_sol: params.gen1_total_sol,
    gen1_total_usdc: params.gen1_total_usdc,
    gen2_total_sol: params.gen2_total_sol,
    gen2_total_usdc: params.gen2_total_usdc,
    gen1_next_date: params.gen1_next_date,
    gen2_next_date: params.gen2_next_date,
  })
  const depositor = params.depositorWallet.trim()

  const gen1Sol = numOrZero(params.gen1_total_sol)
  const gen2Sol = numOrZero(params.gen2_total_sol)
  const gen1Usdc = numOrZero(params.gen1_total_usdc)
  const gen2Usdc = numOrZero(params.gen2_total_usdc)
  const totalSol = gen1Sol + gen2Sol
  const totalUsdc = gen1Usdc + gen2Usdc

  if (totalSol <= 0 && totalUsdc <= 0) {
    throw new StakingUserError('Enter a Gen 1 and/or Gen 2 SOL or USDC amount to deposit.', 400)
  }
  if (totalSol > MAX_DEPOSIT_SOL) {
    throw new StakingUserError(`SOL deposit exceeds max of ${MAX_DEPOSIT_SOL} per tx.`, 400)
  }
  if (totalUsdc > MAX_DEPOSIT_USDC) {
    throw new StakingUserError(`USDC deposit exceeds max of ${MAX_DEPOSIT_USDC} per tx.`, 400)
  }

  const solSig = params.sol_signature?.trim() || null
  const usdcSig = params.usdc_signature?.trim() || null

  if (totalSol > 0 && !solSig) {
    throw new StakingUserError('SOL deposit transaction signature is required.', 400)
  }
  if (totalUsdc > 0 && !usdcSig) {
    throw new StakingUserError('USDC deposit transaction signature is required.', 400)
  }
  if (solSig && usdcSig && solSig === usdcSig) {
    throw new StakingUserError('SOL and USDC deposits must use different transaction signatures.', 400)
  }

  let alreadyRecorded = false
  let addGen1Sol = 0
  let addGen2Sol = 0
  let addGen1Usdc = 0
  let addGen2Usdc = 0

  // Ensure period row exists before deposit FK insert
  let period = await getGenOwlRevSharePeriod(periodMonth)
  if (period?.finalized_at) {
    throw new StakingUserError(
      `Rev share for ${periodMonth} is already finalized. Deposit into the next month instead.`,
      400
    )
  }
  if (!period) {
    period = await upsertGenOwlRevSharePeriodTotals({
      period_month: periodMonth,
      gen1_total_sol: 0,
      gen1_total_usdc: 0,
      gen2_total_sol: 0,
      gen2_total_usdc: 0,
    })
    if (!period) {
      throw new StakingUserError('Could not create rev share period row.', 500)
    }
  }

  if (totalSol > 0 && solSig) {
    const existing = await getGenOwlRevShareDepositBySignature(solSig)
    if (existing) {
      alreadyRecorded = true
    } else {
      const verified = await verifyGenOwlRevSharePoolDepositTx({
        transactionSignature: solSig,
        depositorWallet: depositor,
        poolWallet,
        expectedAmount: totalSol,
        currency: 'SOL',
        allowOlderThanHour: Boolean(params.allow_older_tx),
      })
      if (!verified.valid) {
        throw new StakingUserError(verified.error || 'SOL deposit verification failed.', 400)
      }
      const inserted = await insertGenOwlRevShareDeposit({
        period_month: periodMonth,
        currency: 'SOL',
        amount: totalSol,
        gen1_amount: gen1Sol,
        gen2_amount: gen2Sol,
        transaction_signature: solSig,
        depositor_wallet: depositor,
      })
      if (!inserted) {
        throw new StakingUserError('Failed to record SOL deposit.', 500)
      }
      addGen1Sol = gen1Sol
      addGen2Sol = gen2Sol
    }
  }

  if (totalUsdc > 0 && usdcSig) {
    const existing = await getGenOwlRevShareDepositBySignature(usdcSig)
    if (existing) {
      alreadyRecorded = true
    } else {
      const verified = await verifyGenOwlRevSharePoolDepositTx({
        transactionSignature: usdcSig,
        depositorWallet: depositor,
        poolWallet,
        expectedAmount: totalUsdc,
        currency: 'USDC',
        allowOlderThanHour: Boolean(params.allow_older_tx),
      })
      if (!verified.valid) {
        throw new StakingUserError(verified.error || 'USDC deposit verification failed.', 400)
      }
      const inserted = await insertGenOwlRevShareDeposit({
        period_month: periodMonth,
        currency: 'USDC',
        amount: totalUsdc,
        gen1_amount: gen1Usdc,
        gen2_amount: gen2Usdc,
        transaction_signature: usdcSig,
        depositor_wallet: depositor,
      })
      if (!inserted) {
        throw new StakingUserError('Failed to record USDC deposit.', 500)
      }
      addGen1Usdc = gen1Usdc
      addGen2Usdc = gen2Usdc
    }
  }

  if (addGen1Sol > 0 || addGen2Sol > 0 || addGen1Usdc > 0 || addGen2Usdc > 0) {
    const fresh = await getGenOwlRevSharePeriod(periodMonth)
    const nextGen1Sol = numOrZero(fresh?.gen1_total_sol) + addGen1Sol
    const nextGen2Sol = numOrZero(fresh?.gen2_total_sol) + addGen2Sol
    const nextGen1Usdc = numOrZero(fresh?.gen1_total_usdc) + addGen1Usdc
    const nextGen2Usdc = numOrZero(fresh?.gen2_total_usdc) + addGen2Usdc

    period = await upsertGenOwlRevSharePeriodTotals({
      period_month: periodMonth,
      gen1_total_sol: nextGen1Sol,
      gen1_total_usdc: nextGen1Usdc,
      gen2_total_sol: nextGen2Sol,
      gen2_total_usdc: nextGen2Usdc,
    })
    if (!period) {
      throw new StakingUserError('Deposit recorded but period totals failed to update.', 500)
    }

    const schedule = await getRevShareSchedule()
    await updateRevShareSchedule({
      gen1_next_date:
        params.gen1_next_date !== undefined
          ? params.gen1_next_date
          : schedule?.gen1_next_date ?? undefined,
      gen2_next_date:
        params.gen2_next_date !== undefined
          ? params.gen2_next_date
          : schedule?.gen2_next_date ?? undefined,
      next_date:
        params.gen1_next_date !== undefined
          ? params.gen1_next_date
          : schedule?.gen1_next_date ?? schedule?.next_date ?? undefined,
      gen1_total_sol: nextGen1Sol,
      gen1_total_usdc: nextGen1Usdc,
      gen2_total_sol: nextGen2Sol,
      gen2_total_usdc: nextGen2Usdc,
      total_sol: nextGen1Sol + nextGen2Sol,
      total_usdc: nextGen1Usdc + nextGen2Usdc,
    })
  } else {
    period = (await getGenOwlRevSharePeriod(periodMonth)) ?? period
  }

  return {
    period_month: periodMonth,
    period,
    already_recorded: alreadyRecorded && addGen1Sol === 0 && addGen2Sol === 0 && addGen1Usdc === 0 && addGen2Usdc === 0,
    sol_signature: solSig,
    usdc_signature: usdcSig,
  }
}
