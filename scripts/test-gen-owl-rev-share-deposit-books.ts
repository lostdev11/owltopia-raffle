/**
 * Deposit bookkeeping: additive period credits, schedule merge, estimate pool resolve,
 * and liability invariant (deposited == paid + unclaimed) after partial claims.
 * Run: npm run test:gen-owl-rev-share-deposit-books
 */
import assert from 'node:assert/strict'
import type { GenOwlRevSharePeriodRow } from '../lib/db/gen-owl-rev-share-periods'
import {
  addGenOwlRevSharePeriodCredit,
  mergeRevShareScheduleAmountsAfterDeposit,
  resolveGenOwlRevShareEstimatePoolAmount,
} from '../lib/nesting/gen-owl-rev-share-deposit-books'
import { computeGenOwlRevShareLiabilitySnapshot } from '../lib/nesting/gen-owl-rev-share-liability'

// --- Additive period credits (deposit 10 → books 10; second deposit adds) ---
const first = addGenOwlRevSharePeriodCredit({
  previous: null,
  addGen1Sol: 10,
  addGen2Sol: 0,
  addGen1Usdc: 0,
  addGen2Usdc: 0,
})
assert.equal(first.gen1_total_sol, 10)
assert.equal(first.gen2_total_sol, 0)
assert.equal(first.total_sol, 10)

const second = addGenOwlRevSharePeriodCredit({
  previous: first,
  addGen1Sol: 2.5,
  addGen2Sol: 0,
  addGen1Usdc: 0,
  addGen2Usdc: 0,
})
assert.equal(second.gen1_total_sol, 12.5)
assert.equal(second.total_sol, 12.5)

const gen2Add = addGenOwlRevSharePeriodCredit({
  previous: second,
  addGen1Sol: 0,
  addGen2Sol: 7,
  addGen1Usdc: 0,
  addGen2Usdc: 0,
})
assert.equal(gen2Add.gen1_total_sol, 12.5)
assert.equal(gen2Add.gen2_total_sol, 7)
assert.equal(gen2Add.total_sol, 19.5)

// --- Schedule merge: Gen1 deposit must not zero Gen2 homepage ---
const scheduleAfterGen1 = mergeRevShareScheduleAmountsAfterDeposit({
  schedule: {
    gen1_total_sol: 0,
    gen1_total_usdc: 0,
    gen2_total_sol: 1.7,
    gen2_total_usdc: 0,
    total_sol: 1.7,
    total_usdc: 0,
  },
  addGen1Sol: 10,
  addGen2Sol: 0,
  addGen1Usdc: 0,
  addGen2Usdc: 0,
  nextPeriodGen1Sol: 10,
  nextPeriodGen2Sol: 0, // this period has no Gen2 — must not wipe schedule Gen2
  nextPeriodGen1Usdc: 0,
  nextPeriodGen2Usdc: 0,
})
assert.equal(scheduleAfterGen1.gen1_total_sol, 10)
assert.equal(scheduleAfterGen1.gen2_total_sol, undefined) // leave Gen2 untouched
assert.equal(scheduleAfterGen1.total_sol, 11.7) // 10 + preserved 1.7

const scheduleAfterGen2 = mergeRevShareScheduleAmountsAfterDeposit({
  schedule: {
    gen1_total_sol: 10,
    gen1_total_usdc: 0,
    gen2_total_sol: 1.7,
    gen2_total_usdc: 0,
    total_sol: 11.7,
    total_usdc: 0,
  },
  addGen1Sol: 0,
  addGen2Sol: 5,
  addGen1Usdc: 0,
  addGen2Usdc: 0,
  nextPeriodGen1Sol: 0,
  nextPeriodGen2Sol: 5,
  nextPeriodGen1Usdc: 0,
  nextPeriodGen2Usdc: 0,
})
assert.equal(scheduleAfterGen2.gen1_total_sol, undefined)
assert.equal(scheduleAfterGen2.gen2_total_sol, 5)
assert.equal(scheduleAfterGen2.total_sol, 15) // preserved 10 + 5

// --- Estimate: period 0 must not hide positive schedule preview ---
assert.equal(
  resolveGenOwlRevShareEstimatePoolAmount({
    periodAmount: 0,
    scheduleAmount: 1.7,
    useSchedulePreview: true,
  }),
  1.7
)
assert.equal(
  resolveGenOwlRevShareEstimatePoolAmount({
    periodAmount: 10,
    scheduleAmount: 1.7,
    useSchedulePreview: true,
  }),
  10
)
assert.equal(
  resolveGenOwlRevShareEstimatePoolAmount({
    periodAmount: 0,
    scheduleAmount: 1.7,
    useSchedulePreview: false,
  }),
  0
)

// --- Liability: deposit 10, partial claims → paid + unclaimed == 10; remainder stacks ---
function period(
  month: string,
  opts: { gen1Sol?: number; gen2Sol?: number; gen1Eligible?: number; gen2Eligible?: number }
): GenOwlRevSharePeriodRow {
  return {
    period_month: month,
    gen1_total_sol: opts.gen1Sol ?? null,
    gen1_total_usdc: null,
    gen2_total_sol: opts.gen2Sol ?? null,
    gen2_total_usdc: null,
    gen1_eligible_count: opts.gen1Eligible ?? null,
    gen2_eligible_count: opts.gen2Eligible ?? null,
    gen1_standard_eligible_count: null,
    gen1_one_of_one_eligible_count: null,
    gen2_standard_eligible_count: null,
    gen2_one_of_one_eligible_count: null,
    gen1_per_nest_sol: null,
    gen1_per_nest_usdc: null,
    gen1_standard_per_nest_sol: null,
    gen1_standard_per_nest_usdc: null,
    gen1_one_of_one_per_nest_sol: null,
    gen1_one_of_one_per_nest_usdc: null,
    gen2_per_nest_sol: null,
    gen2_per_nest_usdc: null,
    gen2_standard_per_nest_sol: null,
    gen2_standard_per_nest_usdc: null,
    gen2_one_of_one_per_nest_sol: null,
    gen2_one_of_one_per_nest_usdc: null,
    finalized_at: '2026-09-30T00:00:00.000Z',
    updated_at: '2026-09-30T00:00:00.000Z',
  }
}

// Claims open after month end: now = Oct 5 → September window open
const now = new Date(Date.UTC(2026, 9, 5, 12, 0, 0))
const deposited = addGenOwlRevSharePeriodCredit({
  previous: null,
  addGen1Sol: 10,
  addGen2Sol: 0,
  addGen1Usdc: 0,
  addGen2Usdc: 0,
})
assert.equal(deposited.gen1_total_sol, 10)

// 40 of 100 nests claimed @ 0.1 SOL each → 4 paid, 6 unclaimed
const snap = computeGenOwlRevShareLiabilitySnapshot({
  now,
  periods: [period('2026-09', { gen1Sol: deposited.gen1_total_sol, gen1Eligible: 100 })],
  claims: Array.from({ length: 40 }, () => ({
    period_month: '2026-09',
    amount_sol: 0.1,
    amount_usdc: 0,
    sol_transaction_signature: 'paid',
    usdc_transaction_signature: null,
  })),
})
assert.equal(snap.open.deposited_sol, 10)
assert.ok(Math.abs(snap.open.paid_sol - 4) < 1e-9)
assert.ok(Math.abs(snap.open.unclaimed_sol - 6) < 1e-9)
assert.ok(Math.abs(snap.open.paid_sol + snap.open.unclaimed_sol - snap.open.deposited_sol) < 1e-9)
assert.equal(snap.open.claimed_nests, 40)
assert.equal(snap.open.unclaimed_nests, 60)

// Stack a second month (August still open on Oct 5) with no claims
const stacked = computeGenOwlRevShareLiabilitySnapshot({
  now,
  periods: [
    period('2026-09', { gen1Sol: 10, gen1Eligible: 100 }),
    period('2026-08', { gen1Sol: 5, gen1Eligible: 50 }),
  ],
  claims: Array.from({ length: 40 }, () => ({
    period_month: '2026-09',
    amount_sol: 0.1,
    amount_usdc: 0,
    sol_transaction_signature: 'paid',
    usdc_transaction_signature: null,
  })),
})
assert.equal(stacked.open.deposited_sol, 15)
assert.ok(Math.abs(stacked.open.paid_sol - 4) < 1e-9)
assert.ok(Math.abs(stacked.open.unclaimed_sol - 11) < 1e-9)
assert.ok(
  Math.abs(stacked.open.paid_sol + stacked.open.unclaimed_sol - stacked.open.deposited_sol) < 1e-9
)
assert.equal(stacked.open.open_period_count, 2)

// --- Gen2-only: deposit 10 → books 10; partial claims → paid + unclaimed === 10 ---
const gen2Deposited = addGenOwlRevSharePeriodCredit({
  previous: null,
  addGen1Sol: 0,
  addGen2Sol: 10,
  addGen1Usdc: 0,
  addGen2Usdc: 0,
})
assert.equal(gen2Deposited.gen2_total_sol, 10)
assert.equal(gen2Deposited.total_sol, 10)

const gen2Snap = computeGenOwlRevShareLiabilitySnapshot({
  now,
  periods: [period('2026-09', { gen2Sol: gen2Deposited.gen2_total_sol, gen2Eligible: 100 })],
  claims: Array.from({ length: 25 }, () => ({
    period_month: '2026-09',
    amount_sol: 0.1,
    amount_usdc: 0,
    sol_transaction_signature: 'gen2-paid',
    usdc_transaction_signature: null,
  })),
})
assert.equal(gen2Snap.open.deposited_sol, 10)
assert.ok(Math.abs(gen2Snap.open.paid_sol - 2.5) < 1e-9)
assert.ok(Math.abs(gen2Snap.open.unclaimed_sol - 7.5) < 1e-9)
assert.ok(
  Math.abs(gen2Snap.open.paid_sol + gen2Snap.open.unclaimed_sol - gen2Snap.open.deposited_sol) < 1e-9
)

// --- Both gens same period: Gen1 10 + Gen2 5 → 15; Gen1 partial claims leave Gen2 fully owed ---
const bothDeposited = addGenOwlRevSharePeriodCredit({
  previous: null,
  addGen1Sol: 10,
  addGen2Sol: 5,
  addGen1Usdc: 0,
  addGen2Usdc: 0,
})
assert.equal(bothDeposited.gen1_total_sol, 10)
assert.equal(bothDeposited.gen2_total_sol, 5)
assert.equal(bothDeposited.total_sol, 15)

const bothSnap = computeGenOwlRevShareLiabilitySnapshot({
  now,
  periods: [
    period('2026-09', {
      gen1Sol: bothDeposited.gen1_total_sol,
      gen2Sol: bothDeposited.gen2_total_sol,
      gen1Eligible: 100,
      gen2Eligible: 50,
    }),
  ],
  claims: Array.from({ length: 40 }, () => ({
    period_month: '2026-09',
    amount_sol: 0.1,
    amount_usdc: 0,
    sol_transaction_signature: 'gen1-partial',
    usdc_transaction_signature: null,
  })),
})
assert.equal(bothSnap.open.deposited_sol, 15)
assert.ok(Math.abs(bothSnap.open.paid_sol - 4) < 1e-9)
assert.ok(Math.abs(bothSnap.open.unclaimed_sol - 11) < 1e-9)
assert.ok(
  Math.abs(bothSnap.open.paid_sol + bothSnap.open.unclaimed_sol - bothSnap.open.deposited_sol) < 1e-9
)
assert.equal(bothSnap.open.claimed_nests, 40)
assert.equal(bothSnap.open.unclaimed_nests, 110) // 150 eligible - 40 claimed

console.log('test-gen-owl-rev-share-deposit-books: ok')
